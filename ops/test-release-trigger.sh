#!/usr/bin/env bash
# Offline tests for release-trigger.sh: each case runs it with a stub `curl` first on PATH that
# records the request and answers with a chosen HTTP status. Nothing reaches GitHub.
#
#   ops/test-release-trigger.sh
set -Eeuo pipefail

OPS_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/wisp-test-release-trigger.XXXXXX")
trap 'rm -rf -- "$ROOT"' EXIT

failures=0
SB=''
TOKEN=github_pat_example0000000000

new_sandbox() {
    SB=$(mktemp -d "$ROOT/case.XXXXXX")
    export SB
    mkdir -p "$SB/bin"
    # Records its arguments and the config it reads on stdin, then prints the status code -w asks for.
    cat >"$SB/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$SB/args"
cat >"$SB/config"
printf '%s' "$(cat "$SB/status")"
EOF
    chmod +x "$SB/bin/curl"
}

# Usage: run <status> [token]: runs the trigger against a stub GitHub answering <status>; sets $status.
run() {
    echo "$1" >"$SB/status"
    status=0
    PATH="$SB/bin:$PATH" RELEASE_TRIGGER_TOKEN=${2-$TOKEN} "$OPS_DIR/release-trigger.sh" >"$SB/out" 2>&1 || status=$?
}

fail() {
    echo "FAIL $CASE: $*"
    sed 's/^/    /' "$SB/out"
    failures=$((failures + 1))
}

test_starts_the_release_workflow_on_main() {
    run 204
    ((status == 0)) || fail "exit $status"
    grep -qx 'https://api.github.com/repos/tempo-co/tempo/actions/workflows/release.yml/dispatches' "$SB/args" || fail "wrong endpoint"
    grep -q '"ref":"main"' "$SB/args" || fail "not dispatched on main"
    grep -q "Authorization: Bearer $TOKEN" "$SB/config" || fail "token not sent in the request config"
    ! grep -q "$TOKEN" "$SB/args" || fail "token appears in curl's arguments"
}

test_refused_dispatch_exits_with_an_error() {
    run 401
    ((status != 0)) || fail "exit 0 on 401"
    grep -q '401' "$SB/out" || fail "status not reported"
}

test_missing_token_exits_with_an_error_and_sends_nothing() {
    run 204 ''
    ((status != 0)) || fail "exit 0 without a token"
    [[ ! -e $SB/args ]] || fail "a request was sent without a token"
}

for CASE in $(declare -F | awk '{print $3}' | grep '^test_'); do
    new_sandbox
    "$CASE"
done
((failures == 0)) || { echo "$failures release-trigger test(s) failed"; exit 1; }
echo "all release-trigger tests passed"
