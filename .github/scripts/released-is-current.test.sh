#!/usr/bin/env bash
# Offline tests for released-is-current.sh: each case runs a copy of the script in a temporary git
# repository with a stub `released-revision.sh` beside it. Nothing reaches a registry.
#
#   .github/scripts/released-is-current.test.sh
set -Eeuo pipefail

SCRIPTS_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/released-is-current-test.XXXXXX")
trap 'rm -rf -- "$ROOT"' EXIT

failures=0
SB=''
declare -A C=()

# Usage: commit <name> <file>: a commit on the current branch that changes that file.
commit() {
    mkdir -p "$SB/repo/$(dirname -- "$2")"
    echo "$1" >>"$SB/repo/$2"
    git -C "$SB/repo" add -- "$2"
    git -C "$SB/repo" commit -q -m "change $1"
    C[$1]=$(git -C "$SB/repo" rev-parse HEAD)
}

# History on main: a1 (API) - w1 (web) - a2 (API) - w2 (web), and s1 (API) on a branch off a1 that
# never merged.
new_sandbox() {
    SB=$(mktemp -d "$ROOT/case.XXXXXX")
    mkdir -p "$SB/repo/.github/scripts" "$SB/fake"
    git -C "$SB/repo" init -q -b main
    git -C "$SB/repo" config user.email test@example.com
    git -C "$SB/repo" config user.name Test
    commit a1 apps/api/src/main.ts
    git -C "$SB/repo" checkout -q -b side
    commit s1 apps/api/src/main.ts
    git -C "$SB/repo" checkout -q main
    commit w1 apps/web/src/main.ts
    commit a2 apps/api/src/main.ts
    commit w2 apps/web/src/main.ts
    cp -- "$SCRIPTS_DIR/released-is-current.sh" "$SB/repo/.github/scripts/released-is-current.sh"
    # The registry: $FAKE/<app>_<tag> holds the commit the tag's image was built from.
    cat >"$SB/repo/.github/scripts/released-revision.sh" <<'EOF'
#!/usr/bin/env bash
file=$FAKE/${1#*/}_$2
[[ -f $file ]] || { echo "no tag $2" >&2; exit 3; }
cat "$file"
EOF
    chmod +x "$SB/repo/.github/scripts/"*
}

# Usage: tag <app> <tag> <commit name>: the tag's image was built from that commit.
tag() { echo "${C[$3]}" >"$SB/fake/$1_$2"; }

# Runs released-is-current.sh for example/api:main against <commit name> and the API's paths;
# sets $status, output in $SB/out.
check() {
    status=0
    (cd "$SB/repo" && env -i PATH="/usr/local/bin:/usr/bin:/bin" FAKE="$SB/fake" \
        bash .github/scripts/released-is-current.sh example/api main "${C[$1]}" apps/api packages/contracts) \
        >"$SB/out" 2>&1 || status=$?
}

fail() {
    echo "  FAIL: $*" >&2
    sed 's/^/  | /' "$SB/out" >&2 2>/dev/null || true
    exit 1
}
expect_status() { [[ $status == "$1" ]] || fail "exit status $status, expected $1"; }
expect_output() { grep -qF -- "$1" "$SB/out" || fail "output lacks: $1"; }

test_tag_built_from_the_last_change_is_current() {
    tag api main a2
    check w2
    expect_status 0
    expect_output "includes ${C[a2]}"
}

test_tag_built_after_the_last_change_is_current() {
    tag api main w2
    check w2
    expect_status 0
}

test_tag_older_than_the_last_change_is_stale() {
    tag api main w1
    check w2
    expect_status 1
    expect_output "is older than ${C[a2]}"
}

test_change_to_any_listed_path_counts() {
    commit k1 packages/contracts/src/index.ts
    commit w3 apps/web/src/main.ts
    tag api main w2
    check w3
    expect_status 1
    expect_output "is older than ${C[k1]}"
}

test_tag_built_off_this_history_is_stale() {
    tag api main s1
    check w2
    expect_status 1
}

test_tag_built_from_an_unknown_commit_is_stale() {
    echo 'not-a-commit' >"$SB/fake/api_main"
    check w2
    expect_status 1
    expect_output 'unknown commit (not-a-commit)'
}

test_missing_tag_is_stale() {
    check w2
    expect_status 1
    expect_output 'no tag main'
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
((failures == 0)) || { echo "$failures released-is-current.sh test(s) failed" >&2; exit 1; }
echo 'all released-is-current.sh tests passed'
