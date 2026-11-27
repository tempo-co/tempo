#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/wisp-web-security-headers.XXXXXX")
suffix=${tmp_dir##*/}
image="wisp-web-security-headers:${suffix}"
container="wisp-web-security-headers-${suffix}"
mcp_upstream="${container}-mcp"
neighbour="${container}-neighbour"

cleanup() {
    docker rm -f "$mcp_upstream" >/dev/null 2>&1 || true
    docker rm -f "$neighbour" >/dev/null 2>&1 || true
    docker rm -f "$container" >/dev/null 2>&1 || true
    docker network rm "$neighbour" >/dev/null 2>&1 || true
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
elif mode == 'compressed':
    assert status == 200, f'expected HTTP 200, got {status}'
    assert headers.get('content-encoding') == 'gzip', f'{headers_path} is not gzip-compressed'
    assert 'accept-encoding' in headers.get('vary', '').lower(), f'{headers_path} lacks Vary: Accept-Encoding'
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
        'content-encoding',
    ):
        assert name not in headers, f'SPA {name} leaked to proxied response'
else:
    raise AssertionError(f'unknown header assertion mode {mode!r}')
PY
}

# The image builds from the repository root, which holds the shared contracts package.
docker build \
    --file "$repo_root/Dockerfile.production" \
    --tag "$image" \
    "$repo_root/../.." >/dev/null

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

# Every request offers gzip, so only the app's own files coming back compressed passes.
check() {
    local name=$1 path=$2 kind=$3
    curl -sS --max-time 5 -H 'Accept-Encoding: gzip' -D "$tmp_dir/$name.headers" -o /dev/null \
        "http://127.0.0.1:$port$path"
    assert_headers "$tmp_dir/$name.headers" "$kind"
}
check spa / spa
check asset /favicon.svg spa
# Emails link the header image by absolute URL; a missing file would come back as the app page.
email_header_type=$(curl -fsS --max-time 5 -o /dev/null -w '%{content_type}' "http://127.0.0.1:$port/email-header.png")
[[ $email_header_type == image/png ]] || { echo "email header image served as '$email_header_type'" >&2; exit 1; }
check deep-link /bank-transactions spa
encoded_search=$(python3 -c 'from urllib.parse import quote; print(quote("€" * 1000))')
check unicode-api-search "/api/bank-transactions?filter%5Bsearch%5D=$encoded_search" proxy
check unicode-search "/bank-transactions?search=$encoded_search" spa
check api /api/health proxy
check mcp /api/mcp proxy
check callback /bank-connections/callback proxy
index_html=$(curl -sS --max-time 5 "http://127.0.0.1:$port/")
for asset in js css; do
    [[ $index_html =~ (/assets/[^\"]+\.$asset) ]] || { echo "index.html links no .$asset asset" >&2; exit 1; }
    check "app-$asset" "${BASH_REMATCH[1]}" compressed
done

# What a browser tab, an installed app and a pasted link show, and every image they name is served.
python3 - "$port" <<'PY'
import json
import sys
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urlsplit

origin = f'http://127.0.0.1:{sys.argv[1]}'


class Head(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ''
        self.in_title = False
        self.meta = {}
        self.manifest = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'title':
            self.in_title = True
        elif tag == 'meta' and 'content' in attrs:
            self.meta[attrs.get('property') or attrs.get('name')] = attrs['content']
        elif tag == 'link' and attrs.get('rel') == 'manifest':
            self.manifest = attrs['href']

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data


def served(path, content_type):
    with urllib.request.urlopen(origin + path, timeout=5) as response:
        assert response.status == 200, f'{path}: HTTP {response.status}'
        assert response.headers['Content-Type'].startswith(content_type), f'{path}: {response.headers["Content-Type"]}'
        return response.read()


head = Head()
head.feed(served('/', 'text/html').decode())
assert head.title == 'Wisp', f'page title {head.title!r}'
for name in ('description', 'og:title', 'og:description', 'og:image', 'og:type', 'twitter:card'):
    assert head.meta.get(name), f'missing {name} meta'
assert head.meta['og:title'] == 'Wisp', head.meta['og:title']
assert head.meta['og:type'] == 'website', head.meta['og:type']
assert head.meta['twitter:card'] == 'summary_large_image', head.meta['twitter:card']
image = urlsplit(head.meta['og:image'])
assert image.scheme == 'https' and image.netloc, f'og:image is not an absolute HTTPS URL: {head.meta["og:image"]!r}'
preview = served(image.path, 'image/png')
assert preview[16:24] == (1200).to_bytes(4, 'big') + (630).to_bytes(4, 'big'), 'the preview image is not 1200x630'

manifest = json.loads(served(head.manifest, 'application/manifest+json'))
assert manifest['name'] == 'Wisp' and manifest['short_name'] == 'Wisp', manifest
assert manifest['id'] == '/' and manifest['start_url'] == '/' and manifest['scope'] == '/', manifest
assert manifest['icons'], 'the manifest names no icons'
for icon in manifest['icons']:
    served(icon['src'], icon['type'])
print('wisp web title, link preview and manifest: PASS')
PY

# The first streamed event must arrive before a second request releases the final event.
# Sharing only the network namespace keeps the synthetic API isolated from host services.
docker run --detach --name "$mcp_upstream" \
    --network "container:$container" \
    --volume "$repo_root/scripts/mcp-proxy-server.mjs:/server.mjs:ro" \
    --volume "$repo_root/../api/src/app/modules/banking/bank-logos/bank-logo-reference.ts:/bank-logo-reference.ts:ro" \
    node:26-alpine node /server.mjs >/dev/null
python3 - "$port" <<'PY'
import json
import re
from urllib.parse import quote
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
print('wisp MCP proxy streaming and request limit: PASS')

# A statement import, and the file sent to work out its columns, are larger than Nginx's default 1 MB request limit;
# they must reach the API whole.
upload = b'x' * (12 * 1024 * 1024)
for path in ('/bank-imports', '/bank-imports/preview', '/bank-imports/layout-proposals'):
    imports = url.removesuffix('/mcp') + path
    with urllib.request.urlopen(urllib.request.Request(imports, data=upload, method='POST'), timeout=10) as response:
        assert response.status == 201, f'expected the {path} upload to reach the API, got {response.status}'
        assert json.load(response)['bytes'] == len(upload), f'the {path} upload reached the API cut short'
    try:
        urllib.request.urlopen(urllib.request.Request(imports, data=b'x' * (26 * 1024 * 1024 + 1), method='POST'), timeout=10)
    except urllib.error.HTTPError as error:
        assert error.code == 413, f'expected {path} size cap HTTP 413, got {error.code}'
    else:
        raise AssertionError(f'{path} uploads larger than 26 MB must be refused')
print('wisp statement import upload size: PASS')

# Use the API's real URL builder, then verify Nginx preserves each name as one segment.
base = url.removesuffix('/mcp')
for name in ('Example Bank', 'Example Bank A/S', 'Example Bank & Épargne', 'Example Bank / ?#%'):
    with urllib.request.urlopen(base + '/bank-logo-reference?name=' + quote(name, safe=''), timeout=5) as response:
        metadata = json.load(response)['metadataUrl']
    for path in (metadata, metadata + '/colour-v2/' + 'a' * 64):
        with urllib.request.urlopen(base + path, timeout=5) as response:
            forwarded = json.load(response)['path']
        assert forwarded == path, f'proxy changed logo path for {name!r}: {forwarded!r}'
        assert re.fullmatch(r'/bank-connections/aspsps/logos/XX/[^/]+(?:/colour-v2/[a-f0-9]{64})?', forwarded), forwarded
print('wisp bank logo proxy paths: PASS')
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

# Production's HTTPS proxy is Caddy, at its fixed address on web's proxy network.
trusted_proxy=$(TEMPO_API_IMAGE=api TEMPO_WEB_IMAGE=web DB_USERNAME=u DB_PASSWORD=p DB_NAME=d \
    ENABLE_BANKING_PRIVATE_KEY_HOST_PATH=/dev/null WISP_PRODUCTION_ENV_FILE=/dev/null docker compose -f "$repo_root/../../ops/production.compose.yml" config --format json |
    python3 -c 'import json, sys; print(json.load(sys.stdin)["services"]["caddy"]["networks"]["proxy"]["ipv4_address"])')

# A request from Caddy's address uses the last X-Forwarded-For entry, which the proxy appends.
docker exec "$container" ip addr add "$trusted_proxy/32" dev lo
docker exec "$container" curl -sS --max-time 5 -o /dev/null --interface "$trusted_proxy" \
    -H 'X-Forwarded-For: 198.51.100.7, 203.0.113.10' "http://$trusted_proxy:8080/?trusted-proxy"
expect_client trusted-proxy 203.0.113.10

# Any other sender keeps its own address whatever it forwards: the container network gateway,
gateway=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}' "$container")
curl -sS --max-time 5 -o /dev/null -H 'X-Forwarded-For: 203.0.113.10' "http://127.0.0.1:$port/?untrusted-sender"
expect_client untrusted-sender "$gateway"

# a local process in web's own container,
docker exec "$container" curl -sS --max-time 5 -o /dev/null \
    -H 'X-Forwarded-For: 203.0.113.10' "http://127.0.0.1:8080/?local-process"
expect_client local-process 127.0.0.1

# and another container on a network it shares with web.
docker network create "$neighbour" >/dev/null
docker network connect "$neighbour" "$container"
docker run --detach --name "$neighbour" --network "$neighbour" --entrypoint sleep "$image" 60 >/dev/null
neighbour_address=$(docker inspect --format "{{(index .NetworkSettings.Networks \"$neighbour\").IPAddress}}" "$neighbour")
web_address=$(docker inspect --format "{{(index .NetworkSettings.Networks \"$neighbour\").IPAddress}}" "$container")
docker exec "$neighbour" curl -sS --max-time 5 -o /dev/null \
    -H 'X-Forwarded-For: 203.0.113.10' "http://$web_address:8080/?other-container"
expect_client other-container "$neighbour_address"

echo 'wisp web security headers: PASS'
