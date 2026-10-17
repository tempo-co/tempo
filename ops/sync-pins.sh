#!/usr/bin/env bash
# Copy image-pin bumps for the installed production Compose files from main.
#
#   sync-pins.sh   # as root, run by tempo-sync-pins.service before every deploy
#
# A file is replaced only when every changed line is a tag@digest `image:` line for the same
# image and major version. Any other change waits for `sudo ops/install.sh production`.
# Exits 1 once per new pending change (and once when main has been unreachable for 6 hours),
# so the host's failure alert fires once instead of every run.
set -Eeuo pipefail
umask 022
# The PIN pattern is the security boundary; keep its character ranges ASCII-only.
export LC_ALL=C

REPO_URL=https://github.com/tempo-co/tempo-api
# Fetched by commit, not branch: the raw CDN caches branch files and could serve an older pin.
SOURCE=${SYNC_PINS_SOURCE:-}
STATE=${STATE_DIRECTORY:-/var/lib/tempo-sync-pins}
declare -A FILES=(
    [docker-compose.production.yml]=${SYNC_PINS_ETC:-/etc/tempo}/production.compose.yml
    [ops/tailscale.compose.yml]=${SYNC_PINS_ETC:-/etc/tempo}/tailscale.compose.yml
)
PIN='^( +)image: ([a-z0-9._/-]+):([A-Za-z0-9._-]+)@sha256:[0-9a-f]{64}$'

log() { echo "tempo-sync-pins: $*"; }

suffix() { [[ $1 == *-* ]] && echo "${1#*-}"; }

# Succeeds when the only differences are pins of the same image and major version.
pin_only_change() {
    local -a old new
    local i indent image tag
    mapfile -t old <"$1"
    mapfile -t new <"$2"
    ((${#old[@]} == ${#new[@]})) || return 1
    for i in "${!old[@]}"; do
        [[ ${old[i]} == "${new[i]}" ]] && continue
        [[ ${old[i]} =~ $PIN ]] || return 1
        indent=${BASH_REMATCH[1]} image=${BASH_REMATCH[2]} tag=${BASH_REMATCH[3]}
        [[ ${new[i]} =~ $PIN ]] || return 1
        [[ ${BASH_REMATCH[1]} == "$indent" && ${BASH_REMATCH[2]} == "$image" ]] || return 1
        # Same major version and same variant suffix (e.g. -trixie never becomes -alpine).
        [[ ${tag%%[.-]*} == "${BASH_REMATCH[3]%%[.-]*}" ]] || return 1
        [[ $(suffix "$tag") == "$(suffix "${BASH_REMATCH[3]}")" ]] || return 1
    done
}

mkdir -p "$STATE"
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT

fetch() {
    if [[ -z $SOURCE ]]; then
        local sha
        sha=$(timeout 20 git ls-remote "$REPO_URL" refs/heads/main | cut -f1) || return 1
        [[ $sha =~ ^[0-9a-f]{40}$ ]] || return 1
        SOURCE=https://raw.githubusercontent.com/tempo-co/tempo-api/$sha
    fi
    local path
    for path in "${!FILES[@]}"; do
        # Worst case stays far below the unit's TimeoutStartSec, so failures reach the state logic.
        curl --fail --silent --show-error --max-time 15 --retry 1 --max-filesize 1M --output "$tmp/${path##*/}" "$SOURCE/$path" || return 1
    done
}

if ! fetch; then
    log 'could not fetch the Compose files from main; nothing changed'
    # Alert once when main has been unreachable for 6 hours; brief outages stay quiet.
    if [[ ! -e $STATE/last-fetch ]]; then
        touch "$STATE/last-fetch"
        exit 0
    fi
    [[ -z $(find "$STATE/last-fetch" -mmin -360) && ! -e $STATE/fetch-alerted ]] || exit 0
    touch "$STATE/fetch-alerted"
    log 'main has been unreachable for 6 hours'
    exit 1
fi
touch "$STATE/last-fetch"
rm -f -- "$STATE/fetch-alerted"

pending=''
for path in "${!FILES[@]}"; do
    installed=${FILES[$path]}
    candidate=$tmp/${path##*/}
    cmp -s "$installed" "$candidate" && continue
    # A NUL byte would hide content from the line comparison below.
    if [[ $(tr -d '\0' <"$candidate" | wc -c) == $(wc -c <"$candidate") ]] && pin_only_change "$installed" "$candidate"; then
        install -m 644 "$candidate" "$installed.new"
        mv -f -- "$installed.new" "$installed"
        log "updated image pins in $installed"
    else
        log "$installed differs from main beyond image pins"
        pending+="$path $(sha256sum <"$candidate")"$'\n'
    fi
done

if [[ -z $pending ]]; then
    rm -f -- "$STATE/pending"
    exit 0
fi
log 'an install is pending: sudo ops/install.sh production from a clean origin/main checkout'
[[ $(cat "$STATE/pending" 2>/dev/null) != "$(printf '%s' "$pending")" ]] || exit 0
printf '%s' "$pending" >"$STATE/pending"
exit 1
