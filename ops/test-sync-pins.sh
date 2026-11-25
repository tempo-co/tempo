#!/usr/bin/env bash
# Offline tests for sync-pins.sh: each case runs the script against copies of this checkout's
# production Compose files in a temporary sandbox. A stub `curl` serves the candidate files from
# "main" and the digests a fake Docker Hub returns; stub `git` and `systemctl` must not be called.
# Nothing reaches the network or the installed Compose files.
#
#   ops/test-sync-pins.sh
set -Eeuo pipefail

OPS_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/wisp-test-sync-pins.XXXXXX")
trap 'rm -rf -- "$ROOT"' EXIT
SOURCE=https://raw.example.test/tempo-co/tempo/0123456789abcdef0123456789abcdef01234567

failures=0
SB=''

digest() { printf 'sha256:%s' "$(printf '%s' "$1" | sha256sum | cut -c1-64)"; }
# The pinned image line of a service in this checkout's Compose file, e.g. postgres:17.11@sha256:...
current_pin() { sed -nE "s|^ +image: ($1:[^@]+@sha256:[0-9a-f]{64})\$|\1|p" "$OPS_DIR/$2"; }

new_sandbox() {
    SB=$(mktemp -d "$ROOT/case.XXXXXX")
    mkdir -p "$SB/bin" "$SB/etc" "$SB/main/ops" "$SB/state"
    cp -- "$OPS_DIR/production.compose.yml" "$SB/etc/production.compose.yml"
    cp -- "$OPS_DIR/production.compose.yml" "$SB/main/ops/production.compose.yml"
    : >"$SB/registry"
    : >"$SB/events.log"
    cat >"$SB/bin/curl" <<'EOF'
#!/usr/bin/env bash
# Serves $FAKE/main/<path> for the source URL and digests from $FAKE/registry ("repo:tag digest").
set -euo pipefail
output='' url=''
while (($#)); do
    case $1 in
        --output) output=$2; shift ;;
        -H | --max-time | --max-filesize | --retry) shift ;;
        http*) url=$1 ;;
    esac
    shift
done
echo "curl $url" >>"$FAKE/events.log"
case $url in
    "$SYNC_PINS_SOURCE"/*)
        [[ -f $FAKE/main/${url#"$SYNC_PINS_SOURCE"/} ]] || exit 22
        cp -- "$FAKE/main/${url#"$SYNC_PINS_SOURCE"/}" "$output"
        ;;
    https://auth.docker.io/token\?*) echo '{"token":"test-token"}' ;;
    https://registry-1.docker.io/v2/*/manifests/*)
        ref=${url#https://registry-1.docker.io/v2/}
        ref=${ref%/manifests/*}:${ref##*/manifests/}
        digest=$(awk -v ref="$ref" '$1 == ref { print $2 }' "$FAKE/registry")
        [[ -n $digest ]] || exit 22
        printf 'HTTP/1.1 200 OK\r\nDocker-Content-Digest: %s\r\n\r\n' "$digest"
        ;;
    *) exit 6 ;;
esac
EOF
    for command in git systemctl; do
        cat >"$SB/bin/$command" <<'EOF'
#!/usr/bin/env bash
echo "${0##*/} $*" >>"$FAKE/events.log"
exit 1
EOF
    done
    chmod +x "$SB/bin/"*
}

# Usage: on_main <file> <old pin> <new pin>: the candidate file on main moves that pin.
on_main() {
    sed -i "s|image: $2\$|image: $3|" "$SB/main/ops/$1"
    grep -qxF "    image: $3" "$SB/main/ops/$1" || fail "could not move $2 in $1"
}
# Usage: serve <repo:tag> <digest>: the fake Docker Hub serves that digest for the tag.
serve() { echo "$1 $2" >>"$SB/registry"; }

sync_pins() {
    status=0
    env -i HOME="$SB" PATH="$SB/bin:/usr/local/bin:/usr/bin:/bin" FAKE="$SB" \
        SYNC_PINS_SOURCE="$SOURCE" SYNC_PINS_ETC="$SB/etc" STATE_DIRECTORY="$SB/state" \
        bash "$OPS_DIR/sync-pins.sh" >"$SB/out" 2>&1 || status=$?
}

fail() {
    echo "  FAIL: $*" >&2
    echo "  --- sync-pins output ---" >&2
    sed 's/^/  | /' "$SB/out" >&2 2>/dev/null || true
    # Each case runs in its own subshell, so this ends only the failing case.
    exit 1
}
expect_status() { [[ $status == "$1" ]] || fail "exit status $status, expected $1"; }
expect_output() { grep -qF -- "$1" "$SB/out" || fail "output lacks: $1"; }
expect_installed() { cmp -s "$SB/etc/$1" "$2" || fail "installed $1 differs from $2"; }
expect_untouched() { expect_installed "$1" "$OPS_DIR/$1"; }
expect_no_calls() { ! grep -qE '^(git|systemctl) ' "$SB/events.log" || fail "unexpected call: $(grep -E '^(git|systemctl) ' "$SB/events.log")"; }

# Usage: expect_refused <file>: the run alerts once, leaves the file alone and stays quiet on the next run.
expect_refused() {
    sync_pins
    expect_status 1
    expect_output "$SB/etc/$1 differs from main beyond image pins"
    expect_output 'an install is pending'
    expect_untouched "$1"
    grep -qF "ops/$1 " "$SB/state/pending" || fail "pending does not name ops/$1"
    sync_pins
    expect_status 0
    expect_untouched "$1"
    expect_no_calls
}

test_forward_bump_is_applied() {
    local postgres caddy
    postgres=$(current_pin postgres production.compose.yml)
    caddy=$(current_pin caddy production.compose.yml)
    [[ -n $postgres && -n $caddy ]] || fail 'could not read the current pins'
    # A higher version of PostgreSQL, and a rebuild of the same Caddy tag.
    on_main production.compose.yml "$postgres" "postgres:17.99@$(digest postgres-17.99)"
    serve library/postgres:17.99 "$(digest postgres-17.99)"
    on_main production.compose.yml "$caddy" "${caddy%@*}@$(digest caddy-rebuild)"
    serve "library/${caddy%@*}" "$(digest caddy-rebuild)"
    sync_pins
    expect_status 0
    expect_output "updated image pins in $SB/etc/production.compose.yml"
    expect_installed production.compose.yml "$SB/main/ops/production.compose.yml"
    [[ ! -e $SB/state/pending ]] || fail 'pending exists after an applied bump'
    expect_no_calls
}

test_downgrade_is_refused() {
    local postgres
    postgres=$(current_pin postgres production.compose.yml)
    on_main production.compose.yml "$postgres" "postgres:17.0@$(digest postgres-17.0)"
    serve library/postgres:17.0 "$(digest postgres-17.0)"
    expect_refused production.compose.yml
}

test_edit_beyond_pins_is_refused() {
    local redis
    redis=$(current_pin redis production.compose.yml)
    on_main production.compose.yml "$redis" "redis:7.99.0@$(digest redis-7.99.0)"
    serve library/redis:7.99.0 "$(digest redis-7.99.0)"
    sed -i '0,/restart: unless-stopped/s//restart: always/' "$SB/main/ops/production.compose.yml"
    expect_refused production.compose.yml
}

test_major_version_change_is_refused() {
    local postgres
    postgres=$(current_pin postgres production.compose.yml)
    on_main production.compose.yml "$postgres" "postgres:99.0@$(digest postgres-99.0)"
    serve library/postgres:99.0 "$(digest postgres-99.0)"
    expect_refused production.compose.yml
}

test_variant_change_is_refused() {
    local redis
    redis=$(current_pin redis production.compose.yml)
    on_main production.compose.yml "$redis" "redis:7.99.0-alpine@$(digest redis-7.99.0-alpine)"
    serve library/redis:7.99.0-alpine "$(digest redis-7.99.0-alpine)"
    expect_refused production.compose.yml
}

test_digest_docker_hub_does_not_serve_is_refused() {
    local postgres
    postgres=$(current_pin postgres production.compose.yml)
    on_main production.compose.yml "$postgres" "postgres:17.99@$(digest postgres-17.99)"
    serve library/postgres:17.99 "$(digest postgres-17.99-other)"
    expect_refused production.compose.yml
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
((failures == 0)) || { echo "$failures sync-pins.sh test(s) failed" >&2; exit 1; }
echo 'all sync-pins.sh tests passed'
