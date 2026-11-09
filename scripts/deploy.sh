#!/usr/bin/env bash
# deploys a commit to staging or production on the server without downtime (blue-green): the image
# the GitHub workflow built (.github/workflows/deploy.yml) is pulled from the registry and started
# next to the live version, caddy is switched over to it once it answers, then the old one stops.
# Runs as the deploy user over SSH, as the forced command of the workflow's key (see "deploying"
# in README.md), so it only takes "<staging|production> <full commit sha>" and builds the image
# name itself: the key can't run anything else.
#
# usage: social-deploy <staging|production> <commit>   (or via SSH_ORIGINAL_COMMAND)
# config: /etc/social-deploy.env (SOCIAL_DEPLOY_CONFIG), see scripts/deploy.env.example
#
# Install it outside the checkouts, so a deploy never rewrites the script while it runs:
#   install -m 755 scripts/deploy.sh /usr/local/bin/social-deploy
set -Eeuo pipefail

log() { echo "> $*"; }
die() {
	echo "deploy: $*" >&2
	exit 1
}

main() {
	local config=${SOCIAL_DEPLOY_CONFIG:-/etc/social-deploy.env}
	# not exported: shell variables would override the compose .env
	# shellcheck source=/dev/null
	[[ -f $config ]] && source "$config"
	: "${IMAGE_REPO:?set IMAGE_REPO in $config}"

	local target sha extra
	read -r target sha extra <<<"${SSH_ORIGINAL_COMMAND:-$*}"
	[[ -z ${extra:-} && $sha =~ ^[0-9a-f]{40}$ ]] || die "usage: <staging|production> <full commit sha>"

	local dir upstream_file
	case $target in
	staging) dir=${STAGING_DIR:-} upstream_file=${STAGING_UPSTREAM_FILE:-} ;;
	production) dir=${PRODUCTION_DIR:-} upstream_file=${PRODUCTION_UPSTREAM_FILE:-} ;;
	*) die "unknown environment: $target" ;;
	esac
	[[ -n $dir && -f $dir/docker-compose.yaml ]] || die "no checkout for $target (set ${target^^}_DIR in $config)"
	[[ -n $upstream_file && -w $upstream_file ]] ||
		die "caddy upstream file of $target missing or not writable (${target^^}_UPSTREAM_FILE in $config)"
	cd "$dir"

	# one deploy per environment at a time
	exec 9>"$dir/.deploy.lock"
	flock -w 600 9 || die "another deploy of $target is still running"

	local image="$IMAGE_REPO:$target-$sha"
	log "deploying ${sha:0:7} to $target ($dir)"

	# the compose file and the scripts follow the deployed commit
	git fetch --quiet origin
	git cat-file -e "$sha^{commit}" 2>/dev/null || die "commit $sha not found in origin"
	git -c advice.detachedHead=false checkout --quiet --detach "$sha"

	# blue-green: the new version starts on the idle colour while the live one keeps serving.
	# blue is the web service (PORT), green is web-green (GREEN_PORT)
	local live
	live=$(env_value SOCIAL_COLOR)
	[[ $live == green ]] || live=blue
	local next=blue live_service=web-green next_service=web image_var=SOCIAL_IMAGE
	if [[ $live == blue ]]; then
		next=green live_service=web next_service=web-green image_var=SOCIAL_IMAGE_GREEN
	fi
	local previous
	previous=$(env_value "$([[ $live == blue ]] && echo SOCIAL_IMAGE || echo SOCIAL_IMAGE_GREEN)")
	log "live: $live${previous:+ ($previous)}, starting $next"

	dc up -d --wait db
	if [[ $target == production ]]; then
		dump_database
	fi

	log "pulling $image"
	# the new image goes into .env only once it serves (below): until then it is given to compose
	# through the environment, which wins over .env
	export "$image_var=$image"
	dc pull --quiet "$next_service"
	# pending migrations run as it starts, while the live colour still serves: they have to work
	# with the previous version of the code too (AGENTS.md)
	dc up -d --no-deps --no-build --force-recreate "$next_service"
	local addr
	addr=$(wait_for_version "$next_service" "$sha") || {
		dc logs --tail 100 "$next_service" >&2 || true
		dc stop "$next_service" || true
		die "the new version didn't come up; $live is still serving the previous one"
	}

	switch_upstream "$upstream_file" "$addr" || {
		dc stop "$next_service" || true
		die "caddy didn't take the new upstream; $live is still serving the previous one"
	}
	# kept in .env, so a manual `docker compose up -d` keeps running these images
	set_env_value "$image_var" "$image"
	set_env_value SOCIAL_COLOR "$next"
	log "$target is serving ${sha:0:7} from $next ($addr)"

	# requests already sent to the old colour finish (stop_grace_period), event streams
	# reconnect to the new one
	sleep "${DRAIN_SECONDS:-5}"
	dc stop "$live_service" || true

	if [[ $target == staging && ${STAGING_SEED:-1} == 1 ]]; then
		# a no-op once the database has accounts
		dc exec -T -u bun -e "SEED_PASSWORD=${SEED_PASSWORD:-}" \
			-e "SEED_BOT_TOKEN=${SEED_BOT_TOKEN:-}" "$next_service" bun scripts/seed.ts
	fi

	# the stopped colour keeps the previous image: a rollback is a redeploy of that commit
	prune_images "$target" "$image" "$previous"
}

dc() { docker compose --profile green "$@"; }

# points caddy at addr: the file holds the `to` line of the reverse_proxy block (README: deploying)
switch_upstream() {
	local file=$1 addr=$2 old
	# caddy in a container reaches the published port through another host name
	[[ -n ${UPSTREAM_HOST:-} ]] && addr="$UPSTREAM_HOST:${addr##*:}"
	old=$(cat "$file")
	printf 'to %s\n' "$addr" >"$file"
	if ! sh -c "${CADDY_RELOAD:-caddy reload --config /etc/caddy/Caddyfile}"; then
		printf '%s\n' "$old" >"$file"
		return 1
	fi
}

# the value of KEY in the compose .env (empty when unset)
env_value() {
	[[ -f .env ]] || return 0
	sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '"'"'"
}

set_env_value() {
	touch .env
	if grep -q "^$1=" .env; then
		sed -i "s|^$1=.*|$1=$2|" .env
	else
		printf '\n# set by scripts/deploy.sh\n%s=%s\n' "$1" "$2" >>.env
	fi
}

# a custom-format dump before migrations run, kept next to the checkout (the last KEEP_DUMPS)
dump_database() {
	local dumps="$PWD/predeploy-dumps" file
	mkdir -p -m 700 "$dumps"
	file="$dumps/$(date -u +%Y%m%dT%H%M%SZ).dump"
	log "dumping the database to $file"
	(umask 077 && docker compose exec -T db pg_dump -U postgres -Fc postgres >"$file") || {
		rm -f "$file"
		die "database dump failed, nothing was deployed"
	}
	ls -1t "$dumps"/*.dump | tail -n +"$((${KEEP_DUMPS:-5} + 1))" | xargs -r rm -f
}

# waits until the service answers with the deployed commit as its SvelteKit version; prints its
# host address
wait_for_version() {
	local port addr
	port=$(env_value PORT)
	addr=$(dc port "$1" "${port:-7777}" 2>/dev/null | head -n 1) || true
	[[ -n $addr ]] || return 1
	addr=${addr/0.0.0.0/127.0.0.1}
	for _ in $(seq 90); do
		if curl -fsS --max-time 5 "http://$addr/_app/version.json" 2>/dev/null | grep -q "\"$2\""; then
			echo "$addr"
			return 0
		fi
		sleep 2
	done
	return 1
}

# keeps the live image and the previous one of this environment, for a quick rollback
prune_images() {
	local tag
	docker image ls "$IMAGE_REPO" --format '{{.Repository}}:{{.Tag}}' | grep -F ":$1-" |
		while read -r tag; do
			[[ $tag == "$2" || $tag == "$3" ]] && continue
			docker image rm "$tag" >/dev/null 2>&1 || true
		done
}

main "$@"
