#!/usr/bin/env bash
# Print the digest a public GHCR image tag points at, so later steps can pull exactly that image.
#
#   released-digest.sh wispmoney/api main
set -euo pipefail
repo=$1 tag=$2
token=$(curl -fsS -m 30 "https://ghcr.io/token?scope=repository:$repo:pull" | jq -r .token)
accept='application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json'
digest=$(curl -fsSI -m 30 -H "Authorization: Bearer $token" -H "Accept: $accept" "https://ghcr.io/v2/$repo/manifests/$tag" |
    tr -d '\r' | awk 'tolower($1) == "docker-content-digest:" { print $2 }')
[[ $digest == sha256:* ]] || { echo "$repo:$tag has no readable digest" >&2; exit 1; }
echo "$digest"
