#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Deploy Tempo API and web images to production or staging.
#
#   deploy.sh production                      # deploy the :main images (run by the timer)
#   deploy.sh staging --api pr-12 --web main  # omitted components keep their current image
#
# Tags resolve to immutable digests before rollout. A failed rollout restores the
# previous images. Database migrations are not rolled back.
#
# Services pinned by tag@digest in the installed Compose files (PINNED_SERVICES, Tailscale)
# are recreated first whenever the pinned image differs from the running one.
set -Eeuo pipefail
shopt -s inherit_errexit

usage() {
    echo "usage: $(basename "$0") <production|staging> [--api TAG] [--web TAG]" >&2
    exit 2
}

TARGET=${1:-}
[[ $TARGET == production || $TARGET == staging ]] || usage
shift
declare -A REQUESTED=()
while (($#)); do
    case $1 in
        --api | --web)
            [[ ${2:-} =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || usage
            REQUESTED[${1#--}]=$2
            shift 2
            ;;
        *) usage ;;
    esac
done

log() { echo "tempo-deploy[$TARGET]: $*"; }
die() {
    log "ERROR: $*" >&2
    exit 1
}

SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
# shellcheck source=targets/staging.env
source "$SCRIPT_DIR/targets/$TARGET.env"
[[ -n $DEFAULT_TAG || ${#REQUESTED[@]} -gt 0 ]] || usage
# Health wait per service. A failed rollout plus rollback waits up to 4x this, plus ~2 min per health check.
WAIT_TIMEOUT=${WAIT_TIMEOUT:-120}

export DOCKER_HOST DOCKER_CONFIG
unset DOCKER_CONTEXT TEMPO_API_IMAGE TEMPO_WEB_IMAGE

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || {
    log 'another deployment is running'
    # The timer just skips this run; a manual deploy must not look successful.
    ((${#REQUESTED[@]} == 0)) || exit 75
    exit 0
}

compose() {
    docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" --env-file "$IMAGES_FILE" "$@"
}

repository() { echo "ghcr.io/tempo-co/$1"; }

# Retry a registry pull so a short DNS or network blip does not fail the whole run.
retry_pull() {
    local attempt
    for attempt in 1 2 3; do
        "$@" && return 0
        ((attempt < 3)) || return 1
        log "pull failed (attempt $attempt of 3); retrying in $((attempt * 15))s" >&2
        sleep $((attempt * 15))
    done
}

running_image() {
    local ref
    ref=$(docker inspect --format '{{.Config.Image}}' "$COMPOSE_PROJECT-$1-1") || die "no running $1 container"
    # Also accepts the pre-rename ghcr.io/tempo-co/tempo-<component> images.
    [[ $ref == ghcr.io/tempo-co/?(tempo-)"$1"@sha256:* ]] || die "running $1 image is not a pinned digest: $ref"
    echo "$ref"
}

# Pull a tag and print the digest reference the registry returned for it.
resolve() {
    local repo output digest
    repo=$(repository "$1")
    output=$(retry_pull docker pull "$repo:$2") || die "could not pull $repo:$2"
    digest=$(sed -nE 's/^Digest: (sha256:[0-9a-f]{64})$/\1/p' <<<"$output")
    [[ -n $digest ]] || die "no digest for $repo:$2"
    echo "$repo@$digest"
}

image_id() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || echo "missing:$1"; }
revision() { docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$1" 2>/dev/null || true; }

# Replace only the image lines; for staging this file also holds the secrets.
write_images() {
    local tmp
    tmp=$(mktemp "$IMAGES_FILE.XXXXXX") || return 1
    if {
        if [[ -f $IMAGES_FILE ]]; then grep -vE '^TEMPO_(API|WEB)_IMAGE=' "$IMAGES_FILE" || (($? == 1)); fi
        printf 'TEMPO_API_IMAGE=%s\nTEMPO_WEB_IMAGE=%s\n' "$1" "$2"
    } >"$tmp" && chmod 600 "$tmp" && mv -- "$tmp" "$IMAGES_FILE"; then
        return 0
    fi
    rm -f -- "$tmp"
    return 1
}

run_hook() { bash -Eeuo pipefail -c "$1"; }

healthy() {
    local url
    for url in $HEALTH_URLS; do
        curl --fail --silent --show-error --max-time 10 --retry 5 --retry-delay 2 --retry-all-errors \
            --output /dev/null "$url" || return 1
    done
}

# Nginx resolves the API address at startup, so web is recreated whenever anything changes.
rollout() {
    write_images "$1" "$2" || return 1
    if [[ $3 == 1 ]]; then
        compose up -d --no-deps --wait --wait-timeout "$WAIT_TIMEOUT" api || return 1
    fi
    compose up -d --no-deps --force-recreate --wait --wait-timeout "$WAIT_TIMEOUT" web || return 1
    healthy
}

tailscale_compose() { docker compose -f "$TAILSCALE_COMPOSE_FILE" "$@"; }

# Recreate pinned services (tag@digest in the installed Compose file) whose running image differs.
# Usage: update_pinned <compose function> <state name> <service>...
update_pinned() {
    local run=$1 failed_file=$STATE_DIR/failed-pins-$2 service pinned id pins=''
    shift 2
    (($#)) || return 0
    local -a changed=()
    for service; do
        pinned=$("$run" config --images "$service") || die "could not read the $service image from Compose"
        [[ $pinned == *@sha256:* ]] || die "$service image is not pinned to a digest: $pinned"
        pins+="$pinned "
        id=$("$run" ps -a -q "$service") || die "could not list the $service container"
        [[ -n $id && $(docker inspect --format '{{.Config.Image}}' "$id") == "$pinned" ]] || changed+=("$service")
    done
    # Keyed on every pin: until one changes, nothing is retried, backed up or deployed on top of it.
    if [[ $(cat "$failed_file" 2>/dev/null) == "$pins" ]]; then
        log "not deploying: these pins already failed to update (delete $failed_file to retry)"
        ((${#REQUESTED[@]} == 0)) || exit 1
        exit 0
    fi
    rm -f -- "$failed_file"
    ((${#changed[@]})) || return 0
    log "updating ${changed[*]} to the pinned images"
    retry_pull "$run" pull --quiet "${changed[@]}" || die "could not pull ${changed[*]}"
    if [[ " ${changed[*]} " == *' postgres '* && -n ${BEFORE_DATA_CHANGE:-} ]]; then
        log "running pre-deploy step: $BEFORE_DATA_CHANGE"
        run_hook "$BEFORE_DATA_CHANGE" || die "pre-deploy step failed; ${changed[*]} not updated"
    fi
    if ! "$run" up -d --no-deps --wait --wait-timeout "$WAIT_TIMEOUT" "${changed[@]}" || ! healthy; then
        echo "$pins" >"$failed_file"
        die "${changed[*]} unhealthy after the update; there is no automatic rollback"
    fi
    log "updated ${changed[*]}"
}

# shellcheck disable=SC2086 # space-separated service list
update_pinned compose app ${PINNED_SERVICES:-}
[[ -z ${TAILSCALE_COMPOSE_FILE:-} ]] || update_pinned tailscale_compose tailscale tailscale

current_api=$(running_image api)
current_web=$(running_image web)

declare -A target=([api]=$current_api [web]=$current_web)
for component in api web; do
    tag=${REQUESTED[$component]:-$DEFAULT_TAG}
    [[ -n $tag ]] || continue
    target[$component]=$(resolve "$component" "$tag")
done

api_changed=0
web_changed=0
[[ $(image_id "${target[api]}") == "$(image_id "$current_api")" ]] && target[api]=$current_api || api_changed=1
[[ $(image_id "${target[web]}") == "$(image_id "$current_web")" ]] && target[web]=$current_web || web_changed=1
if ((!api_changed && !web_changed)); then
    log "no change: API $(revision "$current_api"), web $(revision "$current_web")"
    exit 0
fi

# The timer would otherwise retry (and back up before) the same broken images every run.
FAILED_FILE=$STATE_DIR/failed-images
if ((${#REQUESTED[@]} == 0)) && [[ $(cat "$FAILED_FILE" 2>/dev/null) == "${target[api]} ${target[web]}" ]]; then
    log "skipping images that already failed to deploy (delete $FAILED_FILE to retry)"
    exit 0
fi

log "deploying API $(revision "${target[api]}") (${target[api]#*@}), web $(revision "${target[web]}") (${target[web]#*@})"
if ((api_changed)) && [[ -n ${BEFORE_DATA_CHANGE:-} ]]; then
    log "running pre-deploy step: $BEFORE_DATA_CHANGE"
    run_hook "$BEFORE_DATA_CHANGE" || die 'pre-deploy step failed; nothing was deployed'
fi

if ! rollout "${target[api]}" "${target[web]}" "$api_changed"; then
    log 'rollout failed; restoring the previous images' >&2
    echo "${target[api]} ${target[web]}" >"$FAILED_FILE"
    if rollout "$current_api" "$current_web" "$api_changed"; then
        die 'rolled back to the previous images (database migrations are not rolled back)'
    fi
    die 'ROLLBACK FAILED; the application is unhealthy and needs attention'
fi
rm -f -- "$FAILED_FILE"
log 'deployed and healthy'

# Remove Tempo images that no container (running or stopped) uses.
docker image prune --all --force --filter 'label=org.opencontainers.image.source=https://github.com/tempo-co/tempo' >/dev/null || true

if [[ -n ${AFTER_DEPLOY:-} ]]; then
    log "running post-deploy step: $AFTER_DEPLOY"
    run_hook "$AFTER_DEPLOY" || die 'post-deploy step failed; the new images stay deployed'
fi
