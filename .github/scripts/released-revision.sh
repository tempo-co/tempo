#!/usr/bin/env bash
# Print the commit (org.opencontainers.image.revision label) a public GHCR image tag was built from.
#
#   released-revision.sh tempo-co/tempo-api main
set -euo pipefail
repo=$1 tag=$2
token=$(curl -fsS "https://ghcr.io/token?scope=repository:$repo:pull" | jq -r .token)
get() { curl -fsSL -H "Authorization: Bearer $token" -H "Accept: $2" "https://ghcr.io/v2/$repo/$1"; }
accept='application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json'
manifest=$(get "manifests/$tag" "$accept")
if jq -e '.manifests' <<<"$manifest" >/dev/null; then
    digest=$(jq -r '[.manifests[] | select(.platform.os == "linux" and .platform.architecture == "amd64")][0].digest' <<<"$manifest")
    manifest=$(get "manifests/$digest" "$accept")
fi
get "blobs/$(jq -r .config.digest <<<"$manifest")" 'application/json' | jq -r '.config.Labels["org.opencontainers.image.revision"] // empty'
