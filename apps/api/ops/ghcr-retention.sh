#!/usr/bin/env bash
# Delete old versions of a repository's GHCR image. Dry run unless --delete.
#
#   ghcr-retention.sh <owner>/<repo> [--delete]
#
# Keeps versions tagged `main`, the images of the last KEEP_MAIN (default 5) main commits
# (rollback targets), versions tagged `pr-<n>` for open PRs, versions younger than KEEP_DAYS
# (default 30), and every manifest those versions reference (the platform image and its
# attestation, which GHCR lists as untagged versions).
set -Eeuo pipefail
shopt -s inherit_errexit

REPO=${1:?usage: ghcr-retention.sh <owner>/<repo> [--delete]}
OWNER=${REPO%/*}
PACKAGE=${REPO#*/}
DELETE=0
[[ ${2:-} == --delete ]] && DELETE=1
KEEP_DAYS=${KEEP_DAYS:-30}
KEEP_MAIN=${KEEP_MAIN:-5}
VERSIONS_API=orgs/$OWNER/packages/container/$PACKAGE/versions
GH_TOKEN=${GH_TOKEN:-$(gh auth token)}
export GH_TOKEN

versions=$(gh api --paginate "$VERSIONS_API?per_page=100" | jq -s 'add')
open_prs=$(gh pr list -R "$REPO" --state open --limit 1000 --json number --jq '[.[].number | "pr-\(.)"]')
recent_main=$(gh api "repos/$REPO/commits?sha=main&per_page=$KEEP_MAIN" --jq '[.[].sha | "sha-\(.)"]')
cutoff=$(date -u -d "-$KEEP_DAYS days" +%Y-%m-%dT%H:%M:%SZ)

jq -e 'any(.[]; .metadata.container.tags | index("main"))' <<<"$versions" >/dev/null ||
    { echo "no version of $PACKAGE is tagged main; refusing to continue" >&2; exit 1; }
kept=$(jq -r --argjson open "$open_prs" --argjson main "$recent_main" --arg cutoff "$cutoff" '
    .[] | select(.created_at >= $cutoff or any(.metadata.container.tags[]; . == "main" or IN($open[]) or IN($main[]))) | .name
' <<<"$versions")

# Manifests referenced by kept image indexes must stay, or the kept tags stop pulling.
# Credentials go through curl's stdin config, not its arguments.
token=$(curl -fsS --config - "https://ghcr.io/token?scope=repository:$OWNER/$PACKAGE:pull" \
    <<<"user = \"x:$GH_TOKEN\"" | jq -r .token)
accept='application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json'
accept+=',application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json'
children() {
    curl -fsS --config - -H "Accept: $accept" "https://ghcr.io/v2/$OWNER/$PACKAGE/manifests/$1" \
        <<<"header = \"Authorization: Bearer $token\"" | jq -r '.manifests[]?.digest'
}
referenced=$(
    for digest in $kept; do
        children "$digest" || { echo "could not read the manifest of kept version $digest" >&2; exit 1; }
    done
)

keep=$(printf '%s\n%s\n' "$kept" "$referenced" | jq -R 'select(. != "")' | jq -sc 'unique')
# Tagged versions (indexes) first, so a failed index delete can still spare its children.
doomed=$(jq -c --argjson keep "$keep" '
    [.[] | select(.name | IN($keep[]) | not)] | sort_by(.metadata.container.tags | length == 0)
' <<<"$versions")

echo "$PACKAGE: $(jq length <<<"$versions") versions, keeping $(jq length <<<"$keep"), deleting $(jq length <<<"$doomed")"
jq -r '.[] | "  \(.id)  \(.created_at[0:10])  \(.name[7:19])  \(.metadata.container.tags | join(",") | if . == "" then "(untagged)" else . end)"' <<<"$doomed"

if ((!DELETE)); then
    echo 'dry run; nothing deleted'
    exit 0
fi

deleted=0
failed=0
spared=' '
while read -r id name tagged; do
    [[ $spared == *" $name "* ]] && continue
    if gh api -X DELETE "$VERSIONS_API/$id" --silent; then
        deleted=$((deleted + 1))
    else
        failed=$((failed + 1))
        echo "::warning::could not delete $PACKAGE version $id ($name)"
        # The surviving index still needs its children to pull.
        if [[ $tagged == true ]]; then spared+="$(children "$name" | tr '\n' ' ') "; fi
    fi
    sleep 1
done < <(jq -r '.[] | "\(.id) \(.name) \(.metadata.container.tags | length > 0)"' <<<"$doomed")
echo "deleted $deleted versions, $failed failed"
((failed == 0))
