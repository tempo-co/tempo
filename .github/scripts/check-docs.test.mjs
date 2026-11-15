// Run with: node --test .github/scripts/
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {checkDocs, countWords} from './check-docs.mjs';

const baseConfig = {
  docs: ['**/README.md', '**/docs/**/*.md'],
  extensions: ['.ts', '.json', '.md', '.sh'],
  budgets: [{pattern: 'README.md', words: 20}],
  defaultBudget: 50,
};

const synthetic = {
  'README.md': 'Synthetic app. Start with `apps/demo/README.md`.\n',
  'apps/demo/package.json': JSON.stringify({scripts: {build: 'tsc', 'test:run': 'vitest'}}),
  'apps/demo/README.md': 'Build with `npm run build`; the entry is `src/main.ts`.\n',
  'apps/demo/src/main.ts': 'export {};\n',
  'apps/demo/docs/guide.md':
    'Tests: `npm --prefix apps/demo run test:run`. Config: `package.json`.\n',
  'scripts/deploy.sh': '#!/bin/sh\n',
};

function run(changes = {}, config = baseConfig) {
  const files = {...synthetic, ...changes};
  for (const [file, content] of Object.entries(files)) {
    if (content === null) delete files[file];
  }
  return checkDocs({tracked: Object.keys(files), read: (file) => files[file], config}).map(
    ({file, line, message}) => `${file}:${line}: ${message}`,
  );
}

test('accepts docs whose paths, scripts and sizes match the repository', () => {
  assert.deepEqual(run(), []);
});

test('reports a backticked path that resolves from no base', () => {
  assert.deepEqual(
    run({
      'apps/demo/README.md':
        'Root `scripts/deploy.sh`, app `src/main.ts`, doc-relative `docs/guide.md`.\n\nGone: `src/old.ts` and `notes.md`.\n',
    }),
    [
      'apps/demo/README.md:3: `src/old.ts` does not exist',
      'apps/demo/README.md:3: `notes.md` does not exist',
    ],
  );
});

test('reports an npm script missing from the package it runs in', () => {
  assert.deepEqual(
    run({
      'apps/demo/docs/guide.md':
        'Run `npm run lint` and `npm --prefix apps/demo run test:e2e`.\n\n```sh\nnpm --prefix apps/none run build\n```sh\nnpm run deploy\n```\n',
    }),
    [
      'apps/demo/docs/guide.md:1: `npm run lint`: no such script in apps/demo/package.json',
      'apps/demo/docs/guide.md:1: `npm run test:e2e`: no such script in apps/demo/package.json',
      'apps/demo/docs/guide.md:4: `npm run build`: no package.json for apps/none',
      'apps/demo/docs/guide.md:6: `npm run deploy`: no such script in apps/demo/package.json',
    ],
  );
});

test('reports a doc over its word budget, counted like wc -w', () => {
  assert.equal(countWords('  one\ttwo\n\nthree-four `five`  '), 4);
  const long = `${'word '.repeat(21)}\n`;
  assert.deepEqual(run({'README.md': long, 'apps/demo/docs/guide.md': `${'word '.repeat(51)}\n`}), [
    'README.md:1: 21 words is over its 20-word budget',
    'apps/demo/docs/guide.md:1: 51 words is over its 50-word budget',
  ]);
});

test('lets a doc exceed its budget only up to an override with a reason', () => {
  const config = {...baseConfig, overrides: {'README.md': {words: 30, reason: 'synthetic reason'}}};
  assert.deepEqual(run({'README.md': `${'word '.repeat(25)}\n`}, config), []);
  assert.deepEqual(run({'README.md': `${'word '.repeat(31)}\n`}, config), [
    'README.md:1: 31 words is over its 30-word override',
  ]);
  assert.deepEqual(run({}, config), [
    'README.md:1: 5 words is within the 20-word budget: remove its override',
  ]);
  const noReason = {...baseConfig, overrides: {'README.md': {words: 30}}};
  assert.deepEqual(run({}, noReason), [
    'config:0: override for README.md needs a one-line `reason`',
  ]);
});

test('skips placeholders, globs, elisions, URLs and paths outside the repository', () => {
  const skipped = [
    '`apps/<name>/src`',
    '`src/**/*.ts`',
    '`apps/.../main.ts`',
    '`npm --prefix apps/demo …`',
    '`https://example.test/a/b`',
    '`/api/v1/health`',
    '`~/.config/demo/runtime.env`',
    '`$XDG_RUNTIME_DIR/demo.sock`',
    '`@demo/contracts`',
    '`DEMO_ROOT=/srv/demo`',
    '`run ./deploy.sh now`',
    '`.json`',
  ].join(' ');
  assert.deepEqual(run({'apps/demo/docs/guide.md': `${skipped}\n`}), []);
});

test('allows a missing path only through a matching, used allowMissing entry', () => {
  const doc = {'apps/demo/README.md': 'Output in `dist/` and `dist/app.js`; see `origin/main`.\n'};
  assert.deepEqual(run(doc), [
    'apps/demo/README.md:1: `dist/` does not exist',
    'apps/demo/README.md:1: `dist/app.js` does not exist',
    'apps/demo/README.md:1: `origin/main` does not exist',
  ]);
  const config = {
    ...baseConfig,
    allowMissing: [
      {paths: ['**/dist/**'], reason: 'build output'},
      {paths: ['origin/main'], docs: ['README.md'], reason: 'a git ref'},
      {paths: ['coverage/**'], reason: 'test output'},
    ],
  };
  assert.deepEqual(run(doc, config), [
    'apps/demo/README.md:1: `origin/main` does not exist',
    'config:0: allowMissing[1] (origin/main) matches nothing: remove it',
    'config:0: allowMissing[2] (coverage/**) matches nothing: remove it',
  ]);
});
