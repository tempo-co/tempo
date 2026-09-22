#!/usr/bin/env bash
set -Eeuo pipefail

WORKFLOW=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)/.github/workflows/staging-promote.yml

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

[[ -f "$WORKFLOW" ]] || fail 'staging promotion workflow is missing'
python3 - "$WORKFLOW" <<'PY'
from pathlib import Path
import re
import sys

text = Path(sys.argv[1]).read_text(encoding='utf-8')
required = {
    'workflow_dispatch:': 'manual dispatch trigger',
    'pr_number:': 'PR number input',
    'gh api "repos/$repo/pulls/$pr"': 'same-repository PR lookup',
    'head_sha="$(jq -r \'.head.sha // ""\' <<<"$pr_json")"': 'exact PR head SHA',
    'gh api --paginate "repos/$repo/actions/runs?head_sha=$head_sha&per_page=100"': 'trusted CI workflow lookup',
    'checks_json=': 'terminal check lookup',
    '[[ "$(jq -r \'.status\' <<<"$trusted_run_json")" == completed ]]': 'completed check requirement',
    '[[ "$(jq -r \'.conclusion\' <<<"$trusted_run_json")" == success ]]': 'successful check requirement',
    '[[ "$head_repo" == "$repo" ]]': 'fork rejection',
    'persist-credentials: false': 'no checkout credential persistence',
    'docker build': 'host-independent image build',
    'docker save': 'build artifact export',
    'docker load': 'publication artifact import',
    'docker push': 'immutable image publication',
    'packages: write': 'registry write permission only on publication',
    'deployments: write': 'deployment metadata permission only on publication',
    'environment: staging': 'protected staging environment',
    'refs/heads/main': 'trusted workflow ref',
    '.github/workflows/staging-promote.yml': 'trusted workflow path',
    'required_contexts: []': 'explicit check verification boundary',
    'gh api --method POST "repos/$repo/deployments"': 'deployment intent creation',
    'gh api --method POST "repos/$repo/deployments/$deployment_id/statuses"': 'successful deployment status',
    'schema_version: 1': 'versioned intent schema',
    'head_sha:': 'intent head SHA',
    'dispatch_sha': 'dispatch workflow revision',
    'image_tag:': 'intent publication tag',
    'staging-${{ github.run_id }}-${{ needs.validate.outputs.head_sha }}': 'unique publication tag',
    'image:': 'intent immutable image',
}
for needle, label in required.items():
    if needle not in text:
        raise SystemExit(f'missing {label}: {needle}')

for forbidden in ('docker.sock', 'ssh', 'tailscale', 'tempo-staging-deploy.sh', 'secrets.STAGING', 'OAUTH'):
    if re.search(re.escape(forbidden), text, re.IGNORECASE):
        raise SystemExit(f'old host/deployment secret surface remains: {forbidden}')

if 'ghcr.io/${{ github.repository_owner }}/tempo-' not in text:
    raise SystemExit('image must publish to the repository owner namespace')
if 'sha256:[0-9a-f]{64}' not in text or 'image_ref=ghcr.io/%s/tempo-web@%s' not in text:
    raise SystemExit('publication must resolve and validate an immutable digest')
if 'payload' not in text or 'repository:' not in text or 'component:' not in text or 'environment:' not in text:
    raise SystemExit('deployment payload is incomplete')

top_level = text.split('jobs:', 1)[0]
if re.search(r'^\s+packages:\s+write', top_level, re.MULTILINE):
    raise SystemExit('package write permission must not be global')
PY

printf 'PASS: staging promotion workflow contract\n'
