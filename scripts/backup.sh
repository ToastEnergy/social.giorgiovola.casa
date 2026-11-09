#!/usr/bin/env bash
# backs up the database and the assets of the docker compose deployment to a restic repository,
# then applies the retention policy. The assets are the avatars/uploads(/dm-uploads) volumes, or,
# when S3_BUCKET is set, a local mirror of the bucket synced with rclone. Run it as root on the
# server (it reads the docker volumes from the host), e.g. from cron or a systemd timer. See
# "backups" in README.md.
#
# usage: scripts/backup.sh [config file]   (default: /etc/social-backup.env)
set -Eeuo pipefail

CONFIG=${1:-/etc/social-backup.env}
if [[ -f $CONFIG ]]; then
	set -a
	# shellcheck source=/dev/null
	source "$CONFIG"
	set +a
fi

# the directory holding docker-compose.yaml (the repository root by default)
COMPOSE_DIR=${COMPOSE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}
KEEP_DAILY=${KEEP_DAILY:-7}
KEEP_WEEKLY=${KEEP_WEEKLY:-4}
KEEP_MONTHLY=${KEEP_MONTHLY:-12}
# share of the repository data read back by `restic check` on every run
CHECK_SUBSET=${CHECK_SUBSET:-2%}
# optional: pinged on success, with /fail appended on failure (healthchecks.io style)
HEALTHCHECK_URL=${HEALTHCHECK_URL:-}
# bucket mode: the bucket, the rclone remote reading it (RCLONE_CONFIG_<REMOTE>_* variables) and
# the local mirror that restic backs up
S3_BUCKET=${S3_BUCKET:-}
S3_REMOTE=${S3_REMOTE:-r2}
MIRROR_DIR=${MIRROR_DIR:-/var/lib/social-backup/assets}

: "${RESTIC_REPOSITORY:?set RESTIC_REPOSITORY (in $CONFIG or the environment)}"
if [[ -z ${RESTIC_PASSWORD:-} && -z ${RESTIC_PASSWORD_FILE:-} && -z ${RESTIC_PASSWORD_COMMAND:-} ]]; then
	echo "set RESTIC_PASSWORD_FILE (or RESTIC_PASSWORD / RESTIC_PASSWORD_COMMAND)" >&2
	exit 1
fi
export RESTIC_REPOSITORY

ping() {
	[[ -z $HEALTHCHECK_URL ]] || curl -fsS -m 10 --retry 3 -o /dev/null "$HEALTHCHECK_URL$1" || true
}
trap 'rc=$?; [[ $rc -eq 0 ]] || ping /fail' EXIT

log() { echo "[$(date '+%F %T')] $*"; }

# never run two backups at once (a slow upload overlapping the next run)
exec 9>/run/lock/social-backup.lock
flock -n 9 || { echo "another backup is running" >&2; exit 1; }

# --stdin-from-command (fails the snapshot when pg_dump fails) needs restic 0.17
restic_version=$(restic version | awk '{print $2}')
if [[ $(printf '%s\n' 0.17.0 "$restic_version" | sort -V | head -n1) != 0.17.0 ]]; then
	echo "restic $restic_version is too old, 0.17 or newer is needed" >&2
	exit 1
fi

if [[ -n $S3_BUCKET ]]; then
	command -v rclone >/dev/null || { echo "S3_BUCKET is set but rclone is not installed" >&2; exit 1; }
	[[ $S3_REMOTE =~ ^[A-Za-z0-9_]+$ ]] || { echo "S3_REMOTE may only hold letters, digits and _" >&2; exit 1; }
	type_var="RCLONE_CONFIG_${S3_REMOTE^^}_TYPE"
	[[ -n ${!type_var:-} ]] || { echo "rclone remote $S3_REMOTE is not configured: set $type_var and the other RCLONE_CONFIG_${S3_REMOTE^^}_* variables" >&2; exit 1; }
	[[ $MIRROR_DIR == /* ]] || { echo "MIRROR_DIR must be an absolute path" >&2; exit 1; }
fi

compose() { docker compose --project-directory "$COMPOSE_DIR" "$@"; }

# volumes are named <project>_<volume>: find them by their compose labels instead of guessing
project=$(compose config | sed -n 's/^name: *//p')
# prints the mountpoint of a volume of the project, or nothing when it doesn't exist
find_volume() {
	local name
	name=$(docker volume ls -q \
		--filter "label=com.docker.compose.project=$project" \
		--filter "label=com.docker.compose.volume=$1")
	[[ -z $name ]] || docker volume inspect -f '{{ .Mountpoint }}' "$name"
}
volume_path() {
	local path
	path=$(find_volume "$1")
	[[ -n $path ]] || { echo "volume $1 of project $project not found" >&2; exit 1; }
	echo "$path"
}
if [[ -z $S3_BUCKET ]]; then
	avatars=$(volume_path avatars)
	uploads=$(volume_path uploads)
	file_paths=("$avatars" "$uploads")
	# private message images on the fs driver; older deployments don't have this volume yet
	dm_uploads=$(find_volume dm-uploads)
	[[ -z $dm_uploads ]] || file_paths+=("$dm_uploads")
fi

# init the repository on the first run
if ! restic cat config >/dev/null 2>&1; then
	log "initializing restic repository $RESTIC_REPOSITORY"
	restic init
fi

# a plain SQL dump (not -Fc) deduplicates well between snapshots, and restic compresses it.
# --clean --if-exists makes the dump replace the existing tables on restore
log "dumping the database"
restic backup --tag db --stdin-from-command --stdin-filename postgres.sql -- \
	docker compose --project-directory "$COMPOSE_DIR" exec -T db \
	pg_dump -U postgres --clean --if-exists --no-owner postgres

if [[ -n $S3_BUCKET ]]; then
	# the mirror holds private message images: root only
	mkdir -p "$MIRROR_DIR"
	chmod 700 "$MIRROR_DIR"
	# --checksum compares sizes and MD5s from the listing, without a HEAD request per object for
	# its modification time. When the sync fails set -e stops here, so a half-synced mirror is
	# never snapshotted (and rclone skips deletions after errors)
	log "syncing bucket $S3_BUCKET to $MIRROR_DIR"
	rclone sync "$S3_REMOTE:$S3_BUCKET" "$MIRROR_DIR" --checksum --fast-list
	log "backing up the bucket mirror"
	restic backup --tag files "$MIRROR_DIR"
else
	log "backing up the asset volumes"
	restic backup --tag files "${file_paths[@]}"
fi

# a restic command run by hand and interrupted (ctrl-c, piped into head, dropped ssh) leaves its
# lock behind, which would block forget --prune. plain unlock only removes stale locks (dead
# process on this host, or older than 30 minutes), never a live one
log "removing stale locks"
restic unlock

log "applying retention"
restic forget --prune --group-by host,tags \
	--keep-daily "$KEEP_DAILY" --keep-weekly "$KEEP_WEEKLY" --keep-monthly "$KEEP_MONTHLY"

# reads back a sample of the data on every run, so damage in the repository shows up early
log "checking the repository"
restic check --read-data-subset="$CHECK_SUBSET"

ping ''
log "done"
