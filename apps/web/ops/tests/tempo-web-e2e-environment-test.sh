#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
PACKAGE=$ROOT/package.json
COMPOSE=$ROOT/docker-compose.e2e.yml
WORKFLOW=$ROOT/.github/workflows/ci.yml

python3 - "$PACKAGE" <<'PY'
import json
import sys
from pathlib import Path

scripts = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))['scripts']
startup = scripts['docker:test:up']
if 'docker compose -p tempo-web -f docker-compose.e2e.yml up -d --wait' not in startup:
    raise SystemExit('web E2E startup must wait for API health before seeding')
PY

python3 - "$COMPOSE" "$WORKFLOW" "$PACKAGE" <<'PY'
import re
import sys
from pathlib import Path

compose = Path(sys.argv[1]).read_text(encoding='utf-8')
workflow = Path(sys.argv[2]).read_text(encoding='utf-8')
package = Path(sys.argv[3]).read_text(encoding='utf-8')
if 'redis-cli' not in compose or compose.count('healthcheck:') < 3:
    raise SystemExit('web E2E dependencies must define healthchecks')
if compose.count('condition: service_healthy') < 3:
    raise SystemExit('web E2E API dependencies must wait for healthy services')
if 'TEMPO_API_E2E_IMAGE' not in workflow or 'sha256:' not in workflow:
    raise SystemExit('web CI must require an immutable API E2E image')
if 'packages: read' not in workflow or 'docker/login-action@' not in workflow or 'password: ${{ github.token }}' not in workflow:
    raise SystemExit('web CI must authenticate read-only to GHCR for the API E2E image')
def variable_expressions(text):
    expressions = re.findall(r'\$\{\{(.*?)\}\}', text, flags=re.DOTALL)
    return [
        expression.strip()
        for expression in expressions
        if re.search(r'\bvars\b', expression, flags=re.IGNORECASE)
    ]

for example in (
    '${{ toJson(vars) }}',
    '${{ toJSON( vars ) }}',
    '${{ vars }}',
    "${{ format('{0}', toJSON(vars)) }}",
):
    if not variable_expressions(example):
        raise SystemExit('web CI vars check must catch case, whitespace, and wrapped expressions')
workflow_lines = workflow.splitlines()
e2e_start = workflow_lines.index('  e2e-test:') + 1
e2e_end = workflow_lines.index('  publish-image:', e2e_start)
e2e_job = workflow_lines[e2e_start:e2e_end]
e2e_job_text = '\n'.join(e2e_job)
if 'to_entries | .[]' in e2e_job_text:
    raise SystemExit('web CI must not enumerate the GitHub vars context in PR-controlled E2E steps')

def step_body(job, name):
    marker = f'      - name: {name}'
    if marker not in job:
        raise SystemExit(f'web CI is missing the {name} step')
    start = job.index(marker) + 1
    end = next(
        (index for index in range(start, len(job)) if job[index].startswith('      - ')),
        len(job),
    )
    return job[start:end]

def step_environment(job, name):
    body = step_body(job, name)
    if '        env:' not in body:
        raise SystemExit(f'web CI is missing step-scoped environment for {name}')
    start = body.index('        env:') + 1
    end = next(
        (
            index
            for index in range(start, len(body))
            if body[index].startswith('        run:') or body[index].startswith('        uses:')
        ),
        len(body),
    )
    return [line.strip() for line in body[start:end]]

image_setting = 'TEMPO_API_E2E_IMAGE: ${{ vars.TEMPO_API_E2E_IMAGE }}'
image_steps = (
    'Validate immutable API E2E image',
    'Pull immutable API E2E image and clear registry credentials',
    'Setup Docker E2E environment',
)
variable_references = variable_expressions(e2e_job_text)
if variable_references != ['vars.TEMPO_API_E2E_IMAGE'] * len(image_steps):
    raise SystemExit('web CI may expose only the step-scoped API image setting from GitHub vars')
for step_name in image_steps:
    if image_setting not in step_environment(e2e_job, step_name):
        raise SystemExit(f'web CI must scope the API image setting to {step_name}')
e2e_test_environment = step_environment(e2e_job, 'Run E2E tests')
for name, value in {
    'VITE_API_URL': 'http://localhost:3000',
    'VITE_APP_URL': 'http://localhost:5173',
    'VITE_EMAIL_UI_URL': 'http://localhost:8025',
}.items():
    if f'{name}: {value}' not in e2e_test_environment:
        raise SystemExit(f'web CI must scope the local E2E value for {name} to Playwright')
if 'docker pull "$TEMPO_API_E2E_IMAGE"' not in workflow or 'docker logout ghcr.io' not in workflow:
    raise SystemExit('web CI must clear GHCR credentials before running PR-controlled E2E commands')
if 'pull_policy: never' not in compose:
    raise SystemExit('web E2E must use the already-pulled immutable API image')
if 'tempo-api:latest' in compose or 'pull api' in package:
    raise SystemExit('web E2E must not use a mutable API image fallback')
PY

printf 'PASS: web E2E startup readiness contract\n'
