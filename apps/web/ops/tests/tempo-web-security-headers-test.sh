#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/tempo-web-security-headers.XXXXXX")
suffix=${tmp_dir##*/}
containers=()
images=()

cleanup() {
    for container in "${containers[@]}"; do
        docker rm -f "$container" >/dev/null 2>&1 || true
    done
    for image in "${images[@]}"; do
        docker image rm "$image" >/dev/null 2>&1 || true
    done
    python3 -c 'import shutil,sys; shutil.rmtree(sys.argv[1], ignore_errors=True)' "$tmp_dir"
}
trap cleanup EXIT

python3 - "$repo_root/.github/workflows/ci.yml" <<'PY'
import re
import sys
from pathlib import Path


def job_section(workflow: str, name: str) -> str:
    section = workflow.split(f"\n  {name}:\n", 1)[1]
    next_job = re.search(r"\n  [A-Za-z0-9_-]+:\n", section)
    return section[:next_job.start()] if next_job else section


def test_security_header_probe_runs_before_publishing(workflow: str) -> None:
    build = job_section(workflow, "build")
    e2e = job_section(workflow, "e2e-test")
    publish = job_section(workflow, "publish-image")

    assert "bash ops/tests/tempo-web-security-headers-test.sh" in build, "the existing build job must run the Nginx security-header probe"
    assert "needs: [build]" in e2e, "E2E must wait for the build job containing the Nginx probe"
    assert "needs: [e2e-test]" in publish, "image publishing must wait for E2E and transitively for the Nginx probe"


test_security_header_probe_runs_before_publishing(Path(sys.argv[1]).read_text(encoding="utf-8"))
PY

assert_headers() {
    python3 - "$1" "$2" <<'PY'
import sys
from pathlib import Path

headers_path = Path(sys.argv[1])
mode = sys.argv[2]
status = None
headers = {}
for line in headers_path.read_text(encoding='utf-8').splitlines():
    if line.startswith('HTTP/'):
        status = int(line.split()[1])
        headers = {}
    elif ':' in line:
        name, value = line.split(':', 1)
        headers[name.strip().lower()] = value.strip()

if mode == 'spa':
    assert status == 200, f'expected SPA HTTP 200, got {status}'
    expected = {
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    }
    for name, value in expected.items():
        assert headers.get(name) == value, f'missing or incorrect {name} in {headers_path}: {headers.get(name)!r}'
    assert 'strict-transport-security' not in headers, 'HSTS belongs at the HTTPS terminator, not the HTTP Nginx listener'
    csp = headers.get('content-security-policy-report-only')
    assert csp, 'missing Content-Security-Policy-Report-Only'
    for directive in (
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https://enablebanking.com",
        "font-src 'self' data:",
        "connect-src 'self'",
    ):
        assert directive in csp, f'CSP candidate missing {directive!r}'
elif mode == 'proxy':
    assert status == 502, f'expected isolated upstream HTTP 502, got {status}'
    for name in (
        'content-security-policy-report-only',
        'x-content-type-options',
        'x-frame-options',
        'referrer-policy',
        'permissions-policy',
        'strict-transport-security',
    ):
        assert name not in headers, f'SPA {name} leaked to proxied response'
else:
    raise AssertionError(f'unknown header assertion mode {mode!r}')
PY
}

assert_redirect_target() {
    local url=$1 expected_path=$2
    local headers_path status
    headers_path=$(mktemp "$tmp_dir/redirect.XXXXXX")
    status=$(curl -sS -o /dev/null -D "$headers_path" -w '%{http_code}' "$url")
    if [[ "$status" != 301 ]]; then
        printf 'expected HTTP 301 at %s, got %s\n' "$url" "$status" >&2
        return 1
    fi
    python3 - "$headers_path" "$expected_path" <<'PY'
import sys
from pathlib import Path
from urllib.parse import urlsplit

location = next(
    (line.split(':', 1)[1].strip() for line in Path(sys.argv[1]).read_text(encoding='utf-8').splitlines() if line.lower().startswith('location:')),
    None,
)
assert location is not None, 'redirect response is missing Location'
parsed = urlsplit(location)
assert not parsed.scheme and not parsed.netloc, f'redirect target must be relative, got {location!r}'
assert not parsed.query and not parsed.fragment, f'redirect target must not contain query or fragment, got {location!r}'
expected = sys.argv[2]
assert parsed.path == expected, f'expected redirect path {expected!r}, got {parsed.path!r}'
PY
}

run_variant() {
    local name=$1 config=$2 api_url=$3 base_path=$4 spa_path=$5 asset_path=$6 api_path=$7 mailpit_path=$8
    local image="tempo-web-security-headers:${suffix}-${name}"
    local container="tempo-web-security-headers-${suffix}-${name}"
    local port headers_file ready=0
    local -a config_args=()
    if [[ "$config" != default ]]; then
        config_args+=(--build-arg "NGINX_CONFIG=$config")
    fi
    images+=("$image")
    containers+=("$container")

    docker build \
        --file "$repo_root/Dockerfile.production" \
        --tag "$image" \
        "${config_args[@]}" \
        --build-arg "VITE_API_URL=$api_url" \
        --build-arg "VITE_BASE_PATH=$base_path" \
        "$repo_root" >/dev/null

    docker run --detach --name "$container" \
        --publish 127.0.0.1::8080 \
        --add-host api:127.0.0.1 \
        --add-host mailpit:127.0.0.1 \
        "$image" >/dev/null
    port=$(docker port "$container" 8080/tcp | python3 -c 'import sys; print(sys.stdin.read().strip().rsplit(":", 1)[1])')

    for _ in $(seq 1 30); do
        if curl -fsS "http://127.0.0.1:$port$spa_path" -o /dev/null 2>/dev/null; then
            ready=1
            break
        fi
        sleep 1
    done
    if [[ "$ready" != 1 ]]; then
        docker logs "$container" >&2
        printf 'Nginx image %s did not serve %s\n' "$config" "$spa_path" >&2
        return 1
    fi

    headers_file="$tmp_dir/${name}-spa.headers"
    curl -sS -D "$headers_file" -o /dev/null "http://127.0.0.1:$port$spa_path"
    assert_headers "$headers_file" spa

    headers_file="$tmp_dir/${name}-asset.headers"
    curl -sS -D "$headers_file" -o /dev/null "http://127.0.0.1:$port$asset_path"
    assert_headers "$headers_file" spa

    headers_file="$tmp_dir/${name}-root.headers"
    curl -sS -D "$headers_file" -o /dev/null "http://127.0.0.1:$port/"
    assert_headers "$headers_file" spa

    if [[ "$name" == staging ]]; then
        headers_file="$tmp_dir/${name}-tempo-prefix.headers"
        curl -sS -D "$headers_file" -o /dev/null "http://127.0.0.1:$port/tempo/"
        assert_headers "$headers_file" spa

        headers_file="$tmp_dir/${name}-tempo-asset.headers"
        curl -sS -D "$headers_file" -o /dev/null "http://127.0.0.1:$port/tempo/favicon.svg"
        assert_headers "$headers_file" spa
    fi

    if [[ "$name" == production ]]; then
        assert_redirect_target "http://127.0.0.1:$port/tempo" /tempo/
    else
        assert_redirect_target "http://127.0.0.1:$port/tempo" /tempo/
        assert_redirect_target "http://127.0.0.1:$port/staging" /staging/
    fi

    headers_file="$tmp_dir/${name}-api.headers"
    curl -sS --max-time 5 -D "$headers_file" -o /dev/null "http://127.0.0.1:$port$api_path"
    assert_headers "$headers_file" proxy

    if [[ -n "$mailpit_path" ]]; then
        headers_file="$tmp_dir/${name}-mailpit.headers"
        curl -sS --max-time 5 -D "$headers_file" -o /dev/null "http://127.0.0.1:$port$mailpit_path"
        assert_headers "$headers_file" proxy
    fi

    printf 'tempo web security headers (%s): PASS\n' "$name"
}

run_variant production default /tempo/api /tempo/ /tempo/ /tempo/favicon.svg /tempo/api/health ''
run_variant staging tempo-staging.conf /staging/api /staging/ /staging/ /staging/favicon.svg /staging/api/health /staging/mailpit/
