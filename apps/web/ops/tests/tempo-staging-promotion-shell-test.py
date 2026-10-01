#!/usr/bin/env python3
"""Execute the trusted workflow shell against synthetic GitHub responses."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import re
import textwrap

ROOT = Path(__file__).resolve().parents[2]
workflow = (ROOT / '.github/workflows/staging-promote.yml').read_text()
SHA = 'a' * 40
PR_SHA = 'b' * 40
REPO = 'tempo-co/tempo-web'
# Read literal run blocks without requiring a YAML package in the CI runner.
blocks = [textwrap.dedent(match) for match in re.findall(
    r'^        run: \|\n((?:          .*\n|\n)+)', workflow, re.MULTILINE)]
validation = blocks[0]
publication = blocks[-1]
for block in blocks:
    subprocess.run(['bash', '-n'], input=block, text=True, check=True)

with tempfile.TemporaryDirectory(prefix='tempo-web-workflow-', dir=os.environ.get('TMPDIR')) as directory:
    scratch = Path(directory)
    gh = scratch / 'gh'
    gh.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
endpoint = next(arg for arg in args if arg.startswith('repos/'))
with open(os.environ['CALLS'], 'a') as log:
    log.write(endpoint + '\\n')
data = json.loads(Path(os.environ['FIXTURE']).read_text())
if '/pulls/' in endpoint:
    print(json.dumps(data['pr']))
elif '/contents/' in endpoint:
    print(data['main_ci'] if endpoint.endswith('ref=main') else data['head_ci'])
elif '/actions/runs?' in endpoint:
    for run in data['runs']: print(json.dumps(run))
elif '/check-runs?' in endpoint:
    for check in data['checks']: print(json.dumps(check))
elif '/status?' in endpoint:
    for status in data['statuses']: print(json.dumps(status))
elif endpoint.endswith('/deployments'):
    Path(os.environ['BODY']).write_text(sys.stdin.read())
    print('300')
elif endpoint.endswith('/deployments/300/statuses'):
    Path(os.environ['STATUS_BODY']).write_text(sys.stdin.read())
    print('{}')
else:
    raise SystemExit('unexpected endpoint: ' + endpoint)
''')
    gh.chmod(0o755)

    def fixture(sha=SHA):
        return {
            'pr': {'head': {'repo': {'full_name': REPO}, 'sha': PR_SHA},
                   'base': {'ref': 'main'}, 'state': 'open', 'merged_at': None, 'draft': False},
            'main_ci': 'trusted-blob', 'head_ci': 'trusted-blob',
            'runs': [{'id': 100, 'head_sha': sha, 'path': '.github/workflows/ci.yml',
                      'check_suite_id': 200, 'event': 'push', 'head_branch': 'main',
                      'head_repository': {'full_name': REPO}, 'status': 'completed', 'conclusion': 'success'}],
            'checks': [{'name': name, 'check_suite': {'id': 200}, 'status': 'completed',
                        'conclusion': 'success'} for name in ('Lint & Format', 'Build', 'E2E Tests')],
            'statuses': [],
        }

    def run_case(name, data=None, source='main', pr='', success=True, **overrides):
        (scratch / 'fixture.json').write_text(json.dumps(data or fixture()))
        output = scratch / 'output'
        output.write_text('')
        calls = scratch / 'calls'
        calls.write_text('')
        env = dict(os.environ, PATH=f'{scratch}:{os.environ["PATH"]}',
                   FIXTURE=str(scratch / 'fixture.json'), CALLS=str(calls),
                   GITHUB_REPOSITORY=REPO, GITHUB_REF='refs/heads/main', GITHUB_SHA=SHA,
                   GITHUB_EVENT_NAME='workflow_dispatch', GITHUB_OUTPUT=str(output),
                   SOURCE=source, PR_NUMBER=pr)
        env.update(overrides)
        result = subprocess.run(['bash', '-c', validation], env=env, text=True, capture_output=True)
        assert (result.returncode == 0) == success, f'{name}: exit {result.returncode}\n{result.stderr}'
        if success:
            values = dict(line.split('=', 1) for line in output.read_text().splitlines())
            assert values == {'head_sha': SHA if source == 'main' else PR_SHA,
                              'source': source, 'pr_number': 'null' if source == 'main' else pr}, (name, values)
            expected_sha = SHA if source == 'main' else PR_SHA
            endpoints = calls.read_text().splitlines()
            expected_endpoints = [
                f'repos/{REPO}/actions/runs?head_sha={expected_sha}&per_page=100',
                f'repos/{REPO}/commits/{expected_sha}/check-runs?per_page=100',
                f'repos/{REPO}/commits/{expected_sha}/status?per_page=100',
            ]
            if source == 'pr':
                expected_endpoints = [
                    f'repos/{REPO}/pulls/{pr}',
                    f'repos/{REPO}/contents/.github/workflows/ci.yml?ref=main',
                    f'repos/{REPO}/contents/.github/workflows/ci.yml?ref={PR_SHA}',
                ] + expected_endpoints
            assert endpoints == expected_endpoints, (name, endpoints)
        else:
            assert output.read_text() == '', f'{name}: emitted approved outputs on rejection'
        print(f'PASS: {name}')

    run_case('main selects dispatch snapshot without a PR lookup')
    run_case('main rejects a supplied PR', pr='42', success=False)
    for source in ('', 'other'):
        run_case(f'invalid source {source!r}', source=source, pr='42', success=False)
    for pr in ('', '0', '-1', '1.5', '01', '1e2', 'null', 'not-a-number'):
        run_case(f'PR rejects invalid input {pr!r}', source='pr', pr=pr, success=False)
    for pr in ('-1', '1.5', 'null', 'not-a-number'):
        run_case(f'main rejects invalid input {pr!r}', pr=pr, success=False)
    run_case('main accepts UI zero as omitted', pr='0')
    run_case('wrong dispatch event', GITHUB_EVENT_NAME='push', success=False)
    run_case('wrong dispatch ref', GITHUB_REF='refs/heads/feature', success=False)
    run_case('wrong repository', GITHUB_REPOSITORY='other/tempo-web', success=False)
    run_case('malformed dispatch SHA', GITHUB_SHA='bad', success=False)
    for key, value in (('event', 'pull_request'), ('head_branch', 'feature'),
                       ('head_repository', {'full_name': 'other/tempo-web'}),
                       ('head_sha', PR_SHA), ('path', '.github/workflows/other.yml'),
                       ('check_suite_id', None)):
        data = fixture()
        data['runs'][0][key] = value
        run_case(f'main rejects untrusted CI {key}', data=data, success=False)
    for status, conclusion in (('in_progress', None), ('completed', 'failure'),
                               ('queued', None), ('completed', 'cancelled')):
        data = fixture()
        data['runs'][0].update(status=status, conclusion=conclusion)
        run_case(f'main rejects CI {status}/{conclusion}', data=data, success=False)
    data = fixture()
    data['runs'] = []
    run_case('main rejects missing CI', data=data, success=False)
    data = fixture()
    data['runs'].append(dict(data['runs'][0], id=101, status='in_progress', conclusion=None))
    run_case('latest pending CI supersedes earlier success', data=data, success=False)
    data['runs'][1].update(status='completed', conclusion='failure')
    run_case('latest failed CI supersedes earlier success', data=data, success=False)
    for name in ('Lint & Format', 'Build', 'E2E Tests'):
        data = fixture()
        data['checks'] = [check for check in data['checks'] if check['name'] != name]
        run_case(f'main requires {name}', data=data, success=False)
    for change in ({'status': 'in_progress'}, {'conclusion': 'failure'},
                   {'conclusion': 'skipped'}, {'check_suite': {'id': 201}}):
        data = fixture()
        data['checks'][2].update(change)
        run_case(f'main rejects unsafe E2E check {change}', data=data, success=False)
    data = fixture()
    data['statuses'] = [{'state': 'pending'}]
    run_case('main rejects pending commit status', data=data, success=False)
    data = fixture(PR_SHA)
    data['runs'][0].update(event='pull_request', head_branch='feature')
    run_case('open PR promotion preserved', data=data, source='pr', pr='42')
    data = fixture(PR_SHA)
    data['pr'].update(state='closed', merged_at='2020-01-01T00:00:00Z')
    run_case('merged PR promotion preserved', data=data, source='pr', pr='42')
    for key, value in (('draft', True), ('state', 'closed'),
                       ('head', {'repo': {'full_name': 'other/tempo-web'}, 'sha': PR_SHA}),
                       ('base', {'ref': 'feature'})):
        data = fixture(PR_SHA)
        data['pr'][key] = value
        run_case(f'PR restriction preserved: {key}', data=data, source='pr', pr='42', success=False)
    data = fixture(PR_SHA)
    data['head_ci'] = 'changed-blob'
    run_case('PR CI parity preserved', data=data, source='pr', pr='42', success=False)
    data = fixture(PR_SHA)
    data['checks'].pop()
    run_case('PR E2E requirement preserved', data=data, source='pr', pr='42', success=False)

    for source, pr, sha in (('main', 'null', SHA), ('pr', '42', PR_SHA)):
        body = scratch / 'deployment.json'
        status_body = scratch / 'status.json'
        image = 'ghcr.io/tempo-co/tempo-web@sha256:' + 'c' * 64
        image_tag = f'ghcr.io/tempo-co/tempo-web:staging-123-{sha}'
        env = dict(os.environ, PATH=f'{scratch}:{os.environ["PATH"]}',
                   FIXTURE=str(scratch / 'fixture.json'), CALLS=str(scratch / 'calls'),
                   BODY=str(body), STATUS_BODY=str(status_body), GITHUB_REPOSITORY=REPO,
                   GITHUB_SHA=SHA, GITHUB_RUN_ID='123', GITHUB_SERVER_URL='https://github.com',
                   SOURCE=source, PR_NUMBER=pr, HEAD_SHA=sha, IMAGE_REF=image, IMAGE_TAG=image_tag)
        subprocess.run(['bash', '-c', publication], env=env, check=True)
        actual = json.loads(body.read_text())
        expected_payload = {
            'schema_version': 2, 'repository': REPO, 'component': 'web', 'environment': 'staging',
            'source': source, 'pr_number': None if source == 'main' else 42, 'head_sha': sha,
            'image': image, 'image_tag': image_tag,
            'workflow': {'path': '.github/workflows/staging-promote.yml', 'ref': 'refs/heads/main',
                         'event': 'workflow_dispatch', 'run_id': 123, 'dispatch_sha': SHA},
        }
        assert actual['payload'] == expected_payload, (source, actual['payload'])
        assert actual['ref'] == sha
        assert actual['environment'] == 'staging'
        assert actual['auto_merge'] is False
        assert actual['required_contexts'] == []
        assert actual['production_environment'] is False
        assert actual['transient_environment'] is False
        assert json.loads(status_body.read_text())['state'] == 'success'
        print(f'PASS: exact schema v2 {source} deployment payload and successful status')
