#!/usr/bin/env bash
# Start the Release workflow on main, which moves `:release` to the newest green `:main`
# (docs/ci-and-images.md, Release). Run nightly by wisp-release-trigger.timer, because GitHub's own
# schedule may start late or not at all.
#
#   RELEASE_TRIGGER_TOKEN=<token> release-trigger.sh
#
# The token is a fine-grained GitHub token for this repository with Actions write only. It goes to
# curl on stdin, never on the command line. Exits 1 when GitHub does not accept the run, for the
# failure email.
set -Eeuo pipefail

TOKEN=${RELEASE_TRIGGER_TOKEN:-}
URL=https://api.github.com/repos/wispmoney/wisp/actions/workflows/release.yml/dispatches

log() { echo "release-trigger: $*"; }

[[ -n $TOKEN ]] || { log 'RELEASE_TRIGGER_TOKEN is not set' >&2; exit 1; }
[[ $TOKEN =~ ^[A-Za-z0-9_]+$ ]] || { log 'RELEASE_TRIGGER_TOKEN holds unexpected characters' >&2; exit 1; }

code=$(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" |
    curl --silent --show-error --max-time 30 --retry 2 --retry-delay 30 --retry-all-errors \
        --output /dev/null --write-out '%{http_code}' --config - \
        -X POST -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
        --data '{"ref":"main"}' "$URL") || code=${code:-000}
if [[ $code != 204 && $code != 200 ]]; then
    log "GitHub did not start the release (HTTP $code)" >&2
    exit 1
fi
log 'started the Release workflow on main'
