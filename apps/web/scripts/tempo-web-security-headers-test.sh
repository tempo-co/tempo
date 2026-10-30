#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/tempo-web-security-headers.XXXXXX")
suffix=${tmp_dir##*/}
image="tempo-web-security-headers:${suffix}"
container="tempo-web-security-headers-${suffix}"
mcp_upstream="${container}-mcp"

cleanup() {
    docker rm -f "$mcp_upstream" >/dev/null 2>&1 || true
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
    assert 'content-security-policy-report-only' not in headers, 'CSP must be enforced, not report-only'
    csp = headers.get('content-security-policy')
    assert csp, 'missing Content-Security-Policy'
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
        assert directive in csp, f'CSP missing {directive!r}'
elif mode == 'proxy':
    assert status == 502, f'expected isolated upstream HTTP 502, got {status}'
    for name in (
        'content-security-policy',
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

# NET_ADMIN lets the test add the trusted proxy address inside the container and send requests from it.
docker run --detach --name "$container" \
    --publish 127.0.0.1::8080 \
    --add-host api:127.0.0.1 \
    --cap-add NET_ADMIN \
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
encoded_search=$(python3 -c 'from urllib.parse import quote; print(quote("€" * 1000))')
check unicode-api-search "/api/bank-transactions?filter%5Bsearch%5D=$encoded_search" proxy
check unicode-search "/bank-transactions?search=$encoded_search" spa
check api /api/health proxy
check mcp /api/mcp proxy
check callback /bank-connections/callback proxy

# The first streamed event must arrive before a second request releases the final event.
# Sharing only the network namespace keeps the synthetic API isolated from host services.
docker run --detach --name "$mcp_upstream" \
    --network "container:$container" \
    --volume "$repo_root/ops/tests/mcp-proxy-server.mjs:/server.mjs:ro" \
    node:22-alpine node /server.mjs >/dev/null
python3 - "$port" <<'PY'
import time
import urllib.error
import urllib.request
import sys

url = f'http://127.0.0.1:{sys.argv[1]}/api/mcp'
for attempt in range(30):
    try:
        with urllib.request.urlopen(url + '?release=1', timeout=2) as response:
            assert response.status == 204
        break
    except urllib.error.HTTPError as error:
        if error.code != 502 or attempt == 29:
            raise
        time.sleep(0.2)

request = urllib.request.Request(url, method='POST',
    data=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}', headers={
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': 'Bearer synthetic-proxy-token',
        'Origin': 'https://example.test',
        'MCP-Protocol-Version': '2025-11-25',
    })
with urllib.request.urlopen(request, timeout=5) as response:
    assert response.headers['Content-Type'] == 'text/event-stream'
    assert response.readline() == b'data: first\n', 'MCP events must reach the client before completion'
    assert response.readline() == b'\n'
    with urllib.request.urlopen(url + '?release=1', timeout=2) as released:
        assert released.status == 204
    assert response.read() == b'data: second\n\n'

try:
    urllib.request.urlopen(urllib.request.Request(url, data=b'x' * (100 * 1024 + 1)), timeout=5)
except urllib.error.HTTPError as error:
    assert error.code == 413, f'expected request size cap HTTP 413, got {error.code}'
else:
    raise AssertionError('MCP requests larger than 100 KiB must be refused')
print('tempo MCP proxy streaming and request limit: PASS')
PY

# Waits for Nginx to log the request whose query is $1 and checks the client address it logged.
expect_client() {
    local marker=$1 expected=$2 line
    for _ in $(seq 1 10); do
        line=$(docker logs "$container" 2>/dev/null | grep -F "GET /?$marker " || true)
        [[ -n "$line" ]] && break
        sleep 0.5
    done
    if [[ "${line%% *}" != "$expected" ]]; then
        docker logs "$container" >&2
        echo "$marker: expected client address $expected, got '${line%% *}'" >&2
        exit 1
    fi
}

# A request from the Tailscale proxy address uses the last X-Forwarded-For entry, which the proxy appends.
trusted_proxy=10.213.47.2
docker exec "$container" ip addr add "$trusted_proxy/32" dev lo
docker exec "$container" curl -sS --max-time 5 -o /dev/null --interface "$trusted_proxy" \
    -H 'X-Forwarded-For: 198.51.100.7, 203.0.113.10' "http://$trusted_proxy:8080/?trusted-proxy"
expect_client trusted-proxy 203.0.113.10

# Any other sender, here the container network gateway, keeps its own address whatever it forwards.
gateway=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}' "$container")
curl -sS --max-time 5 -o /dev/null -H 'X-Forwarded-For: 203.0.113.10' "http://127.0.0.1:$port/?untrusted-sender"
expect_client untrusted-sender "$gateway"

echo 'tempo web security headers: PASS'
