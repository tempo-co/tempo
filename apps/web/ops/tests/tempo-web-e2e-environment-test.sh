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
if 'VITE_EMAIL_UI_URL=http://localhost:8025' not in workflow:
    raise SystemExit('web CI must provide the local Mailpit URL after env history scrub')
if 'docker pull "$TEMPO_API_E2E_IMAGE"' not in workflow or 'docker logout ghcr.io' not in workflow:
    raise SystemExit('web CI must clear GHCR credentials before running PR-controlled E2E commands')
if 'pull_policy: never' not in compose:
    raise SystemExit('web E2E must use the already-pulled immutable API image')
if 'tempo-api:latest' in compose or 'pull api' in package:
    raise SystemExit('web E2E must not use a mutable API image fallback')
PY

printf 'PASS: web E2E startup readiness contract\n'
