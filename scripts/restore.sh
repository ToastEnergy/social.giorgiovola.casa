#!/usr/bin/env bash
# restores the database and the assets from snapshots made by scripts/backup.sh, replacing the
# current data. The assets go back into the avatars/uploads(/dm-uploads) volumes, or, when
# S3_BUCKET is set, into the bucket (with rclone and a token that can write). The app is stopped
# while restoring. Run it as root on the server, after the stack has been created once
# (docker compose up -d). See "backups" in README.md.
#
# usage: scripts/restore.sh [db snapshot] [files snapshot]
#   both default to "latest"; list the ids with `restic snapshots --tag db` / `--tag files`.
#   The config file is /etc/social-backup.env, or the path in BACKUP_CONFIG.
set -euo pipefail

DB_SNAPSHOT=${1:-latest}
FILES_SNAPSHOT=${2:-latest}
CONFIG=${BACKUP_CONFIG:-/etc/social-backup.env}
if [[ -f $CONFIG ]]; then
	set -a
	# shellcheck source=/dev/null
	source "$CONFIG"
	set +a
fi
COMPOSE_DIR=${COMPOSE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}
S3_BUCKET=${S3_BUCKET:-}
S3_REMOTE=${S3_REMOTE:-r2}
MIRROR_DIR=${MIRROR_DIR:-/var/lib/social-backup/assets}
# the rclone remote that writes to the bucket: RCLONE_CONFIG_<RESTORE_REMOTE>_* variables, or,
# when those aren't set, a copy of the backup remote with the RESTORE_ACCESS_KEY_ID /
# RESTORE_SECRET_ACCESS_KEY keys (asked for when not set)
RESTORE_REMOTE=${RESTORE_REMOTE:-r2restore}
: "${RESTIC_REPOSITORY:?set RESTIC_REPOSITORY (in $CONFIG or the environment)}"
export RESTIC_REPOSITORY

compose() { docker compose --project-directory "$COMPOSE_DIR" "$@"; }

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
	[[ -n $path ]] || { echo "volume $1 of project $project not found, run docker compose up -d first" >&2; exit 1; }
	echo "$path"
}

if [[ -n $S3_BUCKET ]]; then
	command -v rclone >/dev/null || { echo "S3_BUCKET is set but rclone is not installed" >&2; exit 1; }
	for remote in "$S3_REMOTE" "$RESTORE_REMOTE"; do
		[[ $remote =~ ^[A-Za-z0-9_]+$ ]] || { echo "rclone remote names may only hold letters, digits and _: $remote" >&2; exit 1; }
	done
	restore_prefix="RCLONE_CONFIG_${RESTORE_REMOTE^^}_"
	type_var="${restore_prefix}TYPE"
	if [[ -z ${!type_var:-} ]]; then
		# no dedicated restore remote: copy the backup remote's settings and swap in the write keys
		backup_prefix="RCLONE_CONFIG_${S3_REMOTE^^}_"
		backup_type="${backup_prefix}TYPE"
		[[ -n ${!backup_type:-} ]] || { echo "rclone remote $S3_REMOTE is not configured: set $backup_type and the other ${backup_prefix}* variables" >&2; exit 1; }
		while IFS= read -r var; do
			export "$restore_prefix${var#"$backup_prefix"}=${!var}"
		done < <(compgen -e | grep "^$backup_prefix" || true)
		if [[ -z ${RESTORE_ACCESS_KEY_ID:-} ]]; then
			read -r -p "Access key ID of a token that can write to $S3_BUCKET: " RESTORE_ACCESS_KEY_ID
		fi
		if [[ -z ${RESTORE_SECRET_ACCESS_KEY:-} ]]; then
			read -r -s -p "Its secret access key: " RESTORE_SECRET_ACCESS_KEY
			echo
		fi
		export "${restore_prefix}ACCESS_KEY_ID=$RESTORE_ACCESS_KEY_ID"
		export "${restore_prefix}SECRET_ACCESS_KEY=$RESTORE_SECRET_ACCESS_KEY"
	fi
	# fail before anything is touched when the token can't reach the bucket
	rclone lsf --max-depth 1 "$RESTORE_REMOTE:$S3_BUCKET" >/dev/null ||
		{ echo "can't list $S3_BUCKET with the restore token" >&2; exit 1; }
	assets="the bucket $S3_BUCKET (objects that aren't in the snapshot are deleted)"
else
	avatars=$(volume_path avatars)
	uploads=$(volume_path uploads)
	dm_uploads=$(find_volume dm-uploads)
	assets="avatars and uploads"
	[[ -z $dm_uploads ]] || assets+=" and message images"
fi

restic snapshots --tag db "$DB_SNAPSHOT"
restic snapshots --tag files "$FILES_SNAPSHOT"
read -r -p "This replaces the database and $assets of '$project'. Continue? [y/N] " answer
[[ $answer == [yY] ]] || exit 1

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# restore the files first, into a temporary directory: nothing is touched if it fails
echo "fetching the files snapshot"
restic restore --tag files "$FILES_SNAPSHOT" --target "$tmp"
if [[ -n $S3_BUCKET ]]; then
	mirror_src=$tmp$MIRROR_DIR
	[[ -d $mirror_src ]] || {
		echo "the files snapshot has no $MIRROR_DIR: set MIRROR_DIR to the path it was backed up from (see the paths above)" >&2
		exit 1
	}
else
	# snapshots hold the volume paths of the machine they were taken on, which can differ here
	find_in_snapshot() {
		find "$tmp" -type d -path "*_$1/_data" | head -n1
	}
	need_in_snapshot() {
		local src
		src=$(find_in_snapshot "$1")
		[[ -n $src ]] || { echo "no $1 volume in the files snapshot" >&2; exit 1; }
		echo "$src"
	}
	avatars_src=$(need_in_snapshot avatars)
	uploads_src=$(need_in_snapshot uploads)
	dm_uploads_src=$(find_in_snapshot dm-uploads)
	if [[ -n $dm_uploads_src && -z $dm_uploads ]]; then
		echo "the snapshot has a dm-uploads volume but this deployment doesn't: update it and run docker compose up -d first" >&2
		exit 1
	fi
fi

echo "stopping the app"
compose stop web
compose up -d db
until compose exec -T db pg_isready -U postgres -q; do sleep 1; done

echo "restoring the database"
restic dump --tag db "$DB_SNAPSHOT" /postgres.sql |
	compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 -q -d postgres

if [[ -n $S3_BUCKET ]]; then
	# no_check_bucket: a token scoped to the bucket may not create (or check for) buckets
	echo "restoring the bucket $S3_BUCKET"
	rclone sync "$mirror_src" "$RESTORE_REMOTE:$S3_BUCKET" --checksum --fast-list --s3-no-check-bucket
else
	restore_volume() {
		find "$2" -mindepth 1 -delete
		cp -a "$1/." "$2/"
	}
	echo "restoring avatars and uploads"
	restore_volume "$avatars_src" "$avatars"
	restore_volume "$uploads_src" "$uploads"
	if [[ -n $dm_uploads_src ]]; then
		echo "restoring message images"
		restore_volume "$dm_uploads_src" "$dm_uploads"
	elif [[ -n $dm_uploads ]]; then
		echo "the snapshot predates the dm-uploads volume, leaving it as it is"
	fi
fi

echo "starting the app"
compose up -d
echo "done"
