#!/usr/bin/env bash
# Exit 0 when a public GHCR image tag was built from a commit that includes the last change to the
# given paths at <commit>; exit 1 when it is older, built off this history, unreadable or missing.
# Needs the full history of the checkout.
#
#   released-is-current.sh wispmoney/api main HEAD^1 apps/api packages/contracts .dockerignore
set -euo pipefail
repo=$1 tag=$2 commit=$3
shift 3
last=$(git log -1 --format=%H "$commit" -- "$@")
if ! revision=$("$(dirname -- "$0")/released-revision.sh" "$repo" "$tag"); then
    echo "$repo:$tag is unreadable or missing"
    exit 1
fi
if ! git cat-file -e "$revision^{commit}" 2>/dev/null; then
    echo "$repo:$tag was built from an unknown commit (${revision:-no revision label})"
    exit 1
fi
if git merge-base --is-ancestor "$last" "$revision"; then
    echo "$repo:$tag ($revision) includes $last, the last change to $*"
else
    echo "$repo:$tag ($revision) is older than $last, the last change to $*"
    exit 1
fi
