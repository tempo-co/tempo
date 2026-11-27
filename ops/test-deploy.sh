#!/usr/bin/env bash
# Offline tests for deploy.sh: each case runs a copy of the script in a temporary sandbox with
# stub `docker`, `curl`, `sleep` and `systemctl` first on PATH and a synthetic target file.
# Nothing reaches a Docker daemon, a registry or the installed deploy tooling.
#
#   ops/test-deploy.sh
set -Eeuo pipefail

OPS_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/wisp-test-deploy.XXXXXX")
trap 'rm -rf -- "$ROOT"' EXIT

failures=0
SB=''

digest() { printf 'sha256:%s' "$(printf '%s' "$1" | sha256sum | cut -c1-64)"; }
api_ref() { echo "ghcr.io/wispmoney/api@$(digest "api-$1")"; }
web_ref() { echo "ghcr.io/wispmoney/web@$(digest "web-$1")"; }
postgres_pin() { echo "postgres:17.11@$(digest "postgres-$1")"; }
redis_pin() { echo "redis:7.4.12@$(digest "redis-$1")"; }

# The tag the real production target deploys by default.
RELEASE_TAG=$(sed -n 's/^DEFAULT_TAG=//p' "$OPS_DIR/targets/production.env")

# Usage: publish <api|web> <build> [tag]: points the component's tag (default: the production tag) at that build.
publish() { digest "$1-$2" >"$SB/fake/tags/$1_${3:-$RELEASE_TAG}"; }
# Usage: pin <service> <pin>: rewrites the service's image line in the installed Compose file.
pin() { sed -i -E "/^  $1:\$/,/image:/ s|image: .*|image: $2|" "$SB/etc/production.compose.yml"; }
container() { cat "$SB/fake/containers/wisp-test-$1-1"; }

new_sandbox() {
    SB=$(mktemp -d "$ROOT/case.XXXXXX")
    mkdir -p "$SB/bin" "$SB/ops/targets" "$SB/etc" "$SB/state" "$SB/fake/tags" "$SB/fake/containers"
    cp -- "$OPS_DIR/deploy.sh" "$SB/ops/deploy.sh"
    cat >"$SB/ops/targets/production.env" <<EOF
# Synthetic target: every path is inside the test sandbox.
COMPOSE_PROJECT=wisp-test
COMPOSE_FILE=$SB/etc/production.compose.yml
ENV_FILE=$SB/etc/production.env
IMAGES_FILE=$SB/state/deployed.env
DOCKER_HOST=unix://$SB/docker.sock
DOCKER_CONFIG=$SB/docker-config
STATE_DIR=$SB/state
DEFAULT_TAG=$RELEASE_TAG
HEALTH_URLS="http://wisp.example.test/api/health http://wisp.example.test/"
PINNED_SERVICES="postgres redis"
TAILSCALE_COMPOSE_FILE=
BEFORE_DATA_CHANGE="$SB/bin/backup"
AFTER_DEPLOY=
EOF
    : >"$SB/etc/production.env"
    cat >"$SB/etc/production.compose.yml" <<EOF
services:
  postgres:
    image: $(postgres_pin 1)
  redis:
    image: $(redis_pin 1)
  api:
    image: \${WISP_API_IMAGE:?}
  web:
    image: \${WISP_WEB_IMAGE:?}
EOF
    printf 'WISP_API_IMAGE=%s\nWISP_WEB_IMAGE=%s\n' "$(api_ref 1)" "$(web_ref 1)" >"$SB/state/deployed.env"
    api_ref 1 >"$SB/fake/containers/wisp-test-api-1"
    web_ref 1 >"$SB/fake/containers/wisp-test-web-1"
    postgres_pin 1 >"$SB/fake/containers/wisp-test-postgres-1"
    redis_pin 1 >"$SB/fake/containers/wisp-test-redis-1"
    for tag in main "$RELEASE_TAG"; do
        publish api 1 "$tag"
        publish web 1 "$tag"
    done
    : >"$SB/fake/unhealthy"
    : >"$SB/fake/unreachable"
    : >"$SB/events.log"
    write_stubs
}

write_stubs() {
    # Docker: containers, tags and failures live in $FAKE; every effect is appended to events.log.
    cat >"$SB/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
event() { echo "$*" >>"$FAKE/../events.log"; }
digest_of() { [[ $1 == *@sha256:* ]] && echo "${1#*@sha256:}"; }
pull_fails() {
    local n
    n=$(cat "$FAKE/pull-failures" 2>/dev/null || echo 0)
    ((n > 0)) || return 1
    echo $((n - 1)) >"$FAKE/pull-failures"
}
case $1 in
    inspect)
        [[ -f $FAKE/containers/$4 ]] || { echo "Error: No such object: $4" >&2; exit 1; }
        cat "$FAKE/containers/$4"
        ;;
    image)
        case $2 in
            prune) event "image prune ${*: -1}" ;;
            inspect)
                d=$(digest_of "$5") || exit 1
                if [[ $4 == *revision* ]]; then echo "rev-${d:0:7}"; else echo "sha256:${d}"; fi
                ;;
            *) exit 1 ;;
        esac
        ;;
    pull)
        event "pull $2"
        if pull_fails; then echo "Error response from daemon: lookup failed" >&2; exit 1; fi
        component=${2#ghcr.io/wispmoney/}
        [[ -f $FAKE/tags/${component%%:*}_${component#*:} ]] || { echo "manifest unknown" >&2; exit 1; }
        echo "${component#*:}: Pulling from wispmoney/${component%%:*}"
        echo "Digest: $(cat "$FAKE/tags/${component%%:*}_${component#*:}")"
        echo "Status: Downloaded newer image for $2"
        ;;
    compose)
        shift
        project='' file='' envs=()
        while [[ $1 == -* ]]; do
            case $1 in
                -p) project=$2 ;;
                -f) file=$2 ;;
                --env-file) envs+=("$2") ;;
                *) exit 1 ;;
            esac
            shift 2
        done
        sub=$1
        shift
        services=()
        while (($#)); do
            case $1 in
                --wait-timeout) shift ;;
                -*) ;;
                *) services+=("$1") ;;
            esac
            shift
        done
        # Like Compose, every command fails while a required ${VAR:?} has no value in the env files.
        for var in $(sed -nE 's/.*\$\{([A-Z_]+):\?.*/\1/p' "$file"); do
            grep -qs "^$var=." "${envs[@]}" || { echo "required variable $var is missing a value" >&2; exit 1; }
        done
        # No service named: every service in the Compose file, in file order.
        ((${#services[@]})) || mapfile -t services < <(sed -nE 's/^  ([a-z]+):$/\1/p' "$file")
        pinned() { sed -nE "/^  $1:\$/,/image:/ s/^ +image: (.*)\$/\1/p" "$file"; }
        image_for() {
            local var
            case $1 in
                api | web)
                    var=WISP_${1^^}_IMAGE
                    grep -h "^$var=" "${envs[@]}" | tail -1 | cut -d= -f2-
                    ;;
                *) pinned "$1" ;;
            esac
        }
        case $sub in
            config) pinned "${services[0]}" ;;
            ps) [[ ! -f $FAKE/containers/$project-${services[0]}-1 ]] || echo "$project-${services[0]}-1" ;;
            pull)
                event "compose pull ${services[*]}"
                if pull_fails; then echo "Error response from daemon: lookup failed" >&2; exit 1; fi
                ;;
            up)
                status=0
                for service in "${services[@]}"; do
                    image=$(image_for "$service")
                    event "compose up $service $image"
                    echo "$image" >"$FAKE/containers/$project-$service-1"
                    if grep -qxF "$image" "$FAKE/unhealthy"; then
                        echo "container $project-$service-1 is unhealthy" >&2
                        status=1
                    fi
                done
                exit "$status"
                ;;
            *) exit 1 ;;
        esac
        ;;
    *) exit 1 ;;
esac
EOF
    cat >"$SB/bin/curl" <<'EOF'
#!/usr/bin/env bash
# The probe fails while web runs an image listed in $FAKE/unreachable.
echo "health ${*: -1}" >>"$FAKE/../events.log"
! grep -qxF "$(cat "$FAKE/containers/wisp-test-web-1")" "$FAKE/unreachable" || exit 22
EOF
    cat >"$SB/bin/sleep" <<'EOF'
#!/usr/bin/env bash
echo "sleep $*" >>"$FAKE/../events.log"
EOF
    cat >"$SB/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >>"$FAKE/../events.log"
echo 'systemctl must not be called by deploy.sh' >&2
exit 1
EOF
    cat >"$SB/bin/backup" <<'EOF'
#!/usr/bin/env bash
echo backup >>"$FAKE/../events.log"
[[ ! -e $FAKE/backup-fails ]] || { echo 'pg_dump: connection refused' >&2; exit 1; }
EOF
    chmod +x "$SB/bin/"*
}

# Runs deploy.sh production in the sandbox; sets $status, output in $SB/out, events since this run in $SB/run.log.
deploy() {
    local start
    start=$(wc -l <"$SB/events.log")
    status=0
    env -i HOME="$SB" PATH="$SB/bin:/usr/local/bin:/usr/bin:/bin" FAKE="$SB/fake" \
        bash "$SB/ops/deploy.sh" production >"$SB/out" 2>&1 || status=$?
    tail -n +"$((start + 1))" "$SB/events.log" >"$SB/run.log"
}

fail() {
    echo "  FAIL: $*" >&2
    echo "  --- deploy output ---" >&2
    sed 's/^/  | /' "$SB/out" >&2 2>/dev/null || true
    echo "  --- events ---" >&2
    sed 's/^/  | /' "$SB/run.log" >&2 2>/dev/null || true
    # Each case runs in its own subshell, so this ends only the failing case.
    exit 1
}
expect_status() { [[ $status == "$1" ]] || fail "exit status $status, expected $1"; }
expect_output() { grep -qF -- "$1" "$SB/out" || fail "output lacks: $1"; }
expect_event() { grep -qxF -- "$1" "$SB/run.log" || fail "no event: $1"; }
expect_no_event() { ! grep -qE -- "$1" "$SB/run.log" || fail "unexpected event matching: $1"; }
expect_events_in_order() {
    local expected
    expected=$(printf '%s\n' "$@")
    [[ $(grep -xF -- "$expected" "$SB/run.log") == "$expected" ]] || fail "events not in order: $*"
}
expect_equal() { [[ $1 == "$2" ]] || fail "$3: got '$1', expected '$2'"; }
expect_deployed() {
    expect_equal "$(cat "$SB/state/deployed.env")" "$(printf 'WISP_API_IMAGE=%s\nWISP_WEB_IMAGE=%s' "$1" "$2")" 'deployed.env'
    expect_equal "$(container api)" "$1" 'running api image'
    expect_equal "$(container web)" "$2" 'running web image'
}

test_healthy_deploy() {
    publish api 2
    deploy
    expect_status 0
    expect_events_in_order 'pull ghcr.io/wispmoney/api:release' 'pull ghcr.io/wispmoney/web:release'
    expect_events_in_order backup "compose up api $(api_ref 2)" "compose up web $(web_ref 1)" \
        'health http://wisp.example.test/api/health' 'health http://wisp.example.test/' \
        'image prune label=org.opencontainers.image.source=https://github.com/wispmoney/wisp'
    expect_output 'deployed and healthy'
    expect_deployed "$(api_ref 2)" "$(web_ref 1)"
    [[ ! -e $SB/state/failed-images ]] || fail 'failed-images exists after a healthy deploy'

    publish api 3 main
    publish web 3 main
    deploy
    expect_status 0
    expect_output 'no change'
    expect_no_event '^(backup|compose up)'
    expect_deployed "$(api_ref 2)" "$(web_ref 1)"

    publish web 2
    deploy
    expect_status 0
    expect_no_event '^backup$'
    expect_no_event '^compose up api'
    expect_event "compose up web $(web_ref 2)"
    expect_deployed "$(api_ref 2)" "$(web_ref 2)"
}

test_unhealthy_image_rolls_back_and_is_skipped_until_the_release_moves() {
    publish api 2
    api_ref 2 >"$SB/fake/unhealthy"
    deploy
    expect_status 1
    expect_events_in_order backup "compose up api $(api_ref 2)" "compose up api $(api_ref 1)" "compose up web $(web_ref 1)"
    expect_output 'rolled back to the previous images'
    expect_deployed "$(api_ref 1)" "$(web_ref 1)"
    expect_equal "$(cat "$SB/state/failed-images")" "$(api_ref 2) $(web_ref 1)" 'failed-images'

    deploy
    expect_status 0
    expect_output 'skipping images that already failed to deploy'
    expect_no_event '^(backup|compose up)'
    expect_deployed "$(api_ref 1)" "$(web_ref 1)"

    publish api 3
    deploy
    expect_status 0
    expect_events_in_order backup "compose up api $(api_ref 3)" "compose up web $(web_ref 1)"
    expect_deployed "$(api_ref 3)" "$(web_ref 1)"
    [[ ! -e $SB/state/failed-images ]] || fail 'failed-images kept after a healthy deploy'
}

test_failing_health_probe_rolls_back() {
    publish web 2
    web_ref 2 >"$SB/fake/unreachable"
    deploy
    expect_status 1
    expect_events_in_order "compose up web $(web_ref 2)" 'health http://wisp.example.test/api/health' \
        "compose up web $(web_ref 1)" 'health http://wisp.example.test/api/health' 'health http://wisp.example.test/'
    expect_output 'rolled back to the previous images'
    expect_deployed "$(api_ref 1)" "$(web_ref 1)"
    expect_equal "$(cat "$SB/state/failed-images")" "$(api_ref 1) $(web_ref 2)" 'failed-images'
}

test_failed_pull_is_retried_twice() {
    publish web 2
    echo 2 >"$SB/fake/pull-failures"
    deploy
    expect_status 0
    expect_events_in_order 'pull ghcr.io/wispmoney/api:release' 'sleep 15' 'pull ghcr.io/wispmoney/api:release' 'sleep 30' \
        'pull ghcr.io/wispmoney/api:release' 'pull ghcr.io/wispmoney/web:release' "compose up web $(web_ref 2)"
    expect_output 'pull failed (attempt 2 of 3); retrying in 30s'
    expect_deployed "$(api_ref 1)" "$(web_ref 2)"
}

test_pull_failing_every_attempt_deploys_nothing() {
    publish api 2
    echo 3 >"$SB/fake/pull-failures"
    deploy
    expect_status 1
    expect_equal "$(grep -c '^pull ' "$SB/run.log")" 3 'pull attempts'
    expect_equal "$(grep '^sleep ' "$SB/run.log" | paste -sd ' ')" 'sleep 15 sleep 30' 'retry waits'
    expect_output 'could not pull ghcr.io/wispmoney/api:release'
    expect_no_event '^(backup|compose up)'
    expect_deployed "$(api_ref 1)" "$(web_ref 1)"
}

test_failed_backup_cancels_the_deploy() {
    publish api 2
    touch "$SB/fake/backup-fails"
    deploy
    expect_status 1
    expect_event backup
    expect_output 'pre-deploy step failed; nothing was deployed'
    expect_no_event '^compose up'
    expect_deployed "$(api_ref 1)" "$(web_ref 1)"
    [[ ! -e $SB/state/failed-images ]] || fail 'failed-images written for a cancelled deploy'
}

test_changed_pin_recreates_its_service() {
    pin postgres "$(postgres_pin 2)"
    deploy
    expect_status 0
    expect_events_in_order 'compose pull postgres' backup "compose up postgres $(postgres_pin 2)"
    expect_no_event '^compose (pull|up) .*redis'
    expect_no_event '^compose up (api|web)'
    expect_output 'updated postgres'
    expect_output 'no change'
    expect_equal "$(container postgres)" "$(postgres_pin 2)" 'running postgres image'

    pin redis "$(redis_pin 2)"
    deploy
    expect_status 0
    expect_events_in_order 'compose pull redis' "compose up redis $(redis_pin 2)"
    expect_no_event '^backup$'
    expect_no_event '^compose (pull|up) postgres'
    expect_equal "$(container redis)" "$(redis_pin 2)" 'running redis image'
}

# A new host: no deployed images yet and no containers.
new_host() {
    rm -f -- "$SB/state/deployed.env" "$SB/fake/containers/"*
}

test_first_deploy_on_a_new_host_starts_the_whole_stack() {
    new_host
    deploy
    expect_status 0
    expect_events_in_order 'pull ghcr.io/wispmoney/api:release' 'pull ghcr.io/wispmoney/web:release' \
        "compose up postgres $(postgres_pin 1)" "compose up redis $(redis_pin 1)" \
        "compose up api $(api_ref 1)" "compose up web $(web_ref 1)" \
        'health http://wisp.example.test/api/health' 'health http://wisp.example.test/'
    expect_no_event '^backup$'
    expect_output 'first start: healthy'
    expect_deployed "$(api_ref 1)" "$(web_ref 1)"

    publish api 2
    deploy
    expect_status 0
    expect_events_in_order backup "compose up api $(api_ref 2)"
    expect_deployed "$(api_ref 2)" "$(web_ref 1)"
}

test_failed_first_deploy_is_tried_again_from_scratch() {
    new_host
    # Staging keeps its settings in the same file as the deployed images.
    echo 'OTHER_SETTING=kept' >"$SB/state/deployed.env"
    web_ref 1 >"$SB/fake/unhealthy"
    deploy
    expect_status 1
    expect_output 'first start failed'
    expect_equal "$(cat "$SB/state/deployed.env")" 'OTHER_SETTING=kept' 'deployed.env after a failed first start'

    : >"$SB/fake/unhealthy"
    deploy
    expect_status 0
    expect_output 'first start: healthy'
    expect_equal "$(cat "$SB/state/deployed.env")" "$(printf 'OTHER_SETTING=kept\nWISP_API_IMAGE=%s\nWISP_WEB_IMAGE=%s' "$(api_ref 1)" "$(web_ref 1)")" 'deployed.env'
    expect_equal "$(container api)" "$(api_ref 1)" 'running api image'
    expect_equal "$(container web)" "$(web_ref 1)" 'running web image'
}

tests=$(declare -F | awk '$3 ~ /^test_/ { print $3 }')
for test in $tests; do
    new_sandbox
    if ("$test"); then
        echo "ok   ${test#test_}"
    else
        echo "FAIL ${test#test_}"
        failures=$((failures + 1))
    fi
done
((failures == 0)) || { echo "$failures deploy.sh test(s) failed" >&2; exit 1; }
echo 'all deploy.sh tests passed'
