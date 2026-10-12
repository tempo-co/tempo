#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/tempo-web-security-headers.XXXXXX")
suffix=${tmp_dir##*/}
image="tempo-web-security-headers:${suffix}"
container="tempo-web-security-headers-${suffix}"

cleanup() {
    docker rm -f "$container" >/dev/null 2>&1 || true
    docker image rm "$image" >/dev/null 2>&1 || true
    python3 -c 'import shutil,sys; shutil.rmtree(sys.argv[1], ignore_errors=True)' "$tmp_dir"
}
trap cleanup EXIT

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

docker build \
    --file "$repo_root/Dockerfile.production" \
    --tag "$image" \
    "$repo_root" >/dev/null

docker run --detach --name "$container" \
    --publish 127.0.0.1::8080 \
    --add-host api:127.0.0.1 \
    "$image" >/dev/null
port=$(docker port "$container" 8080/tcp | python3 -c 'import sys; print(sys.stdin.read().strip().rsplit(":", 1)[1])')

ready=0
for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$port/" -o /dev/null 2>/dev/null; then
        ready=1
        break
    fi
    sleep 1
done
if [[ "$ready" != 1 ]]; then
    docker logs "$container" >&2
    echo 'Nginx image did not serve /' >&2
    exit 1
fi

check() {
    local name=$1 path=$2 kind=$3
    curl -sS --max-time 5 -D "$tmp_dir/$name.headers" -o /dev/null "http://127.0.0.1:$port$path"
    assert_headers "$tmp_dir/$name.headers" "$kind"
}
check spa / spa
check asset /favicon.svg spa
check deep-link /bank-transactions spa
check api /api/health proxy
check callback /bank-connections/callback proxy

# Requests arrive through the container network gateway; the forwarded client address must replace it.
curl -sS --max-time 5 -o /dev/null -H 'X-Forwarded-For: 203.0.113.10' "http://127.0.0.1:$port/?real-ip-check"
real_ip_logged=0
for _ in $(seq 1 10); do
    if [[ "$(docker logs "$container" 2>/dev/null)" =~ (^|$'\n')203\.0\.113\.10\ [^$'\n']*real-ip-check ]]; then
        real_ip_logged=1
        break
    fi
    sleep 0.5
done
if [[ "$real_ip_logged" != 1 ]]; then
    docker logs "$container" >&2
    echo 'Nginx did not use the forwarded client address' >&2
    exit 1
fi

echo 'tempo web security headers: PASS'
