#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
python3 - "$repo_root/nginx/tempo.conf" "$repo_root/nginx/tempo-staging.conf" "$repo_root/Dockerfile.production" "$repo_root/vite.config.ts" <<'PY'
import json
import os
import sys
from pathlib import Path

production, staging, dockerfile, vite_config = [Path(path).read_text(encoding='utf-8') for path in sys.argv[1:]]
for fragment in ['location = /tempo {', 'location /tempo/api/ {', 'location /tempo/ {']:
    assert fragment in production, fragment
for fragment in ['absolute_redirect off;', 'location = /staging {', 'location = /staging/mailpit {', 'location /staging/mailpit/ {', 'location = /staging/bank-connections/callback {', 'location = /staging/api {', 'location /staging/api/ {', 'location /staging/ {', 'proxy_pass http://mailpit:8025/staging/mailpit/;', 'rewrite ^/staging/(.*)$ /$1 break;', 'rewrite ^/staging/api/?(.*)$ /$1 break;']:
    assert fragment in staging, fragment
assert 'location /staging/' not in production
assert 'mailpit' not in production
assert 'location = /staging/mailpit {' in staging
assert 'location /staging/mailpit/ {' in staging
staging_spa = staging.split('location /staging/ {', 1)[1].split('location / {', 1)[0]
assert 'try_files $uri /index.html;' in staging_spa
assert 'try_files $uri $uri/ /index.html;' not in staging_spa
assert 'ARG NGINX_CONFIG=tempo.conf' in dockerfile
assert 'pwaManifestPlugin' in Path(sys.argv[4]).read_text(encoding='utf-8')
public_manifest = Path(sys.argv[1]).parent.parent / 'public/manifest.webmanifest'
assert json.loads(public_manifest.read_text(encoding='utf-8'))['start_url'] == '/'

if os.environ.get('CHECK_STAGING_BUILD') == '1':
    manifest = Path(repo_root := Path(sys.argv[1]).parent.parent / 'dist/manifest.webmanifest')
    assert manifest.exists()
    data = json.loads(manifest.read_text(encoding='utf-8'))
    assert data['id'].startswith('/staging/')
    assert data['start_url'] == '/staging/'
    assert data['scope'] == '/staging/'
    assert all(icon['src'].startswith('/staging/') for icon in data['icons'])
print('tempo web staging path and production isolation contract: PASS')
PY
