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
    if curl -fsS "http://127.0.0.1:$port/tempo/" -o /dev/null 2>/dev/null; then
        ready=1
        break
    fi
    sleep 1
done
if [[ "$ready" != 1 ]]; then
    docker logs "$container" >&2
    echo 'Nginx image did not serve /tempo/' >&2
    exit 1
fi

check() {
    local name=$1 path=$2 kind=$3
    curl -sS --max-time 5 -D "$tmp_dir/$name.headers" -o /dev/null "http://127.0.0.1:$port$path"
    assert_headers "$tmp_dir/$name.headers" "$kind"
}
check spa /tempo/ spa
check asset /tempo/favicon.svg spa
check root / spa
assert_redirect_target "http://127.0.0.1:$port/tempo" /tempo/
check api /tempo/api/health proxy
check api-root /api/health proxy
check callback /tempo/bank-connections/callback proxy

echo 'tempo web security headers: PASS'
