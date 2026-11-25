#!/usr/bin/env bash
# Offline tests for move-tag.sh: each case runs a copy of the script in a temporary git repository
# with a stub `released-revision.sh` beside it and a stub `docker` first on PATH. Nothing reaches
# a registry.
#
#   .github/scripts/move-tag.test.sh
set -Eeuo pipefail

SCRIPTS_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/move-tag-test.XXXXXX")
trap 'rm -rf -- "$ROOT"' EXIT

failures=0
SB=''
declare -A C=()

commit() {
    git -C "$SB/repo" commit -q --allow-empty -m "change $1"
    C[$1]=$(git -C "$SB/repo" rev-parse HEAD)
}

# History: c1 - c2 - c3 on main, and b1 branching off c1 (never merged). The checkout is main at c3.
new_sandbox() {
    SB=$(mktemp -d "$ROOT/case.XXXXXX")
    mkdir -p "$SB/bin" "$SB/repo/.github/scripts" "$SB/fake"
    git -C "$SB/repo" init -q -b main
    git -C "$SB/repo" config user.email test@example.com
    git -C "$SB/repo" config user.name Test
    commit c1
    git -C "$SB/repo" checkout -q -b side
    commit b1
    git -C "$SB/repo" checkout -q main
    commit c2
    commit c3
    cp -- "$SCRIPTS_DIR/move-tag.sh" "$SB/repo/.github/scripts/move-tag.sh"
    # The registry: $FAKE/<app>_<tag> holds the commit the tag's image was built from.
    cat >"$SB/repo/.github/scripts/released-revision.sh" <<'EOF'
#!/usr/bin/env bash
file=$FAKE/${1#*/}_$2
[[ -f $file ]] || { echo "no tag $2" >&2; exit 3; }
cat "$file"
EOF
    cat >"$SB/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >>"$FAKE/../events.log"
EOF
    chmod +x "$SB/bin/"* "$SB/repo/.github/scripts/"*
    : >"$SB/events.log"
}

# Usage: tag <app> <tag> <commit name>: the tag's image was built from that commit.
tag() { echo "${C[$3]}" >"$SB/fake/$1_$2"; }

# Runs move-tag.sh in the checkout; sets $status, output in $SB/out.
move() {
    status=0
    (cd "$SB/repo" && env -i PATH="$SB/bin:/usr/local/bin:/usr/bin:/bin" FAKE="$SB/fake" \
        bash .github/scripts/move-tag.sh "$@") >"$SB/out" 2>&1 || status=$?
}

fail() {
    echo "  FAIL: $*" >&2
    sed 's/^/  | /' "$SB/out" >&2 2>/dev/null || true
    sed 's/^/  events| /' "$SB/events.log" >&2 2>/dev/null || true
    exit 1
}
expect_status() { [[ $status == "$1" ]] || fail "exit status $status, expected $1"; }
expect_output() { grep -qF -- "$1" "$SB/out" || fail "output lacks: $1"; }
expect_no_output() { ! grep -qF -- "$1" "$SB/out" || fail "output has: $1"; }
expect_retag() {
    [[ $(cat "$SB/events.log") == "docker buildx imagetools create --tag ghcr.io/example/$1:$2 ghcr.io/example/$1:sha-${C[$3]}" ]] ||
        fail "expected exactly one retag of $1:$2 to $3"
}
expect_no_retag() { [[ ! -s $SB/events.log ]] || fail 'the tag was moved'; }

test_release_moves_forward_to_main_and_lists_what_ships() {
    tag api release c1
    tag api main c3
    move example/api release main
    expect_status 0
    expect_retag api release c3
    expect_output "change c2"
    expect_output "change c3"
    expect_no_output "change b1"
}

test_release_newer_than_main_stays() {
    tag api release c3
    tag api main c2
    move example/api release main
    expect_status 0
    expect_no_retag
    expect_output 'stays'
}

test_release_off_main_history_fails() {
    tag api release b1
    tag api main c3
    move example/api release main
    expect_status 1
    expect_no_retag
    expect_output 'retag it by hand'
}

test_main_at_a_commit_off_main_history_is_not_released() {
    tag api release c1
    tag api main b1
    move example/api release main
    expect_status 1
    expect_no_retag
}

test_first_release_creates_the_tag_at_main() {
    tag web main c2
    move example/web release main
    expect_status 0
    expect_retag web release c2
}

test_unreadable_release_fails() {
    tag api main c3
    echo 'not-a-commit' >"$SB/fake/api_release"
    move example/api release main
    expect_status 1
    expect_no_retag
    expect_output 'built from an unknown commit (not-a-commit); retag it by hand'
}

test_green_commit_moves_main_forward() {
    tag api main c1
    move example/api main "${C[c3]}"
    expect_status 0
    expect_retag api main c3
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
((failures == 0)) || { echo "$failures move-tag.sh test(s) failed" >&2; exit 1; }
echo 'all move-tag.sh tests passed'
