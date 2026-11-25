#!/usr/bin/env bash
# Move an image tag forward to the image built from a commit on the checked-out history.
#
#   move-tag.sh <owner>/<app> <tag> <commit>       # CI: point :main at this run's tested commit
#   move-tag.sh <owner>/<app> <tag> <source tag>   # release: point :release where :main points
#
# Retags ghcr.io/<owner>/<app>:sha-<commit> as <tag> (no rebuild). The tag only moves forward:
# it is kept when it already points at a newer commit, and an image built from a commit off this
# history (or without a revision label) fails. An absent tag is created. The commit must be on
# the checked-out history (main), so a source tag pointing elsewhere is never released.
# Needs full git history and a registry login.
set -Eeuo pipefail
shopt -s inherit_errexit

usage='usage: move-tag.sh <owner>/<app> <tag> <commit|source tag>'
REPO=${1:?$usage}
TAG=${2:?$usage}
SOURCE=${3:?$usage}
APP=${REPO#*/}
SCRIPTS=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")

die() {
    echo "::error::$*"
    exit 1
}
known_commit() { [[ $1 =~ ^[0-9a-f]{40}$ ]] && git cat-file -e "$1^{commit}" 2>/dev/null; }

if [[ $SOURCE =~ ^[0-9a-f]{40}$ ]]; then
    target=$SOURCE
else
    target=$("$SCRIPTS/released-revision.sh" "$REPO" "$SOURCE") || die "could not read $APP:$SOURCE"
fi
known_commit "$target" || die "$APP:$TAG target ${target:-(no revision label)} is not a known commit"
git merge-base --is-ancestor "$target" HEAD || die "$APP:$SOURCE was built from $target, which is not on main; nothing released"

status=0
current=$("$SCRIPTS/released-revision.sh" "$REPO" "$TAG") || status=$?
if ((status == 3)); then
    echo "$APP:$TAG does not exist yet; creating it at $target"
elif ((status != 0)) || ! known_commit "$current"; then
    die "$APP:$TAG was built from an unknown commit (${current:-no revision label}); retag it by hand"
elif git merge-base --is-ancestor "$target" "$current" && [[ $current != "$target" ]]; then
    echo "$APP:$TAG is at $current, newer than $target; it stays"
    exit 0
elif ! git merge-base --is-ancestor "$current" "$target"; then
    die "$APP:$TAG was built from $current, which is not on $target's history; retag it by hand"
elif [[ $current == "$target" ]]; then
    echo "$APP:$TAG is already at $target; retagging the same commit"
else
    echo "$APP:$TAG moves from $current to $target:"
    git log --oneline --no-decorate "$current..$target"
fi

image=ghcr.io/$REPO
docker buildx imagetools create --tag "$image:$TAG" "$image:sha-$target"
