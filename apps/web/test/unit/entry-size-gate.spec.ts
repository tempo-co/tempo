// The CI step's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const SCRIPT = new URL('../../scripts/check-entry-size.mjs', import.meta.url).pathname;

/** A built app: an index.html that loads `entry` and preloads `preloaded`, plus a lazy chunk it never names. */
function builtApp(sizes: {entry: number; preloaded: number; lazy: number}, base = '/') {
  const dist = mkdtempSync(join(tmpdir(), 'entry-size-'));
  mkdirSync(join(dist, 'assets'));
  // Random bytes don't compress, so each file's Brotli size is about its raw size.
  const write = (name: string, bytes: number) =>
    writeFileSync(join(dist, 'assets', name), `/*${randomBytes(bytes).toString('base64')}*/`);
  write('index-abc.js', sizes.entry);
  write('vendor-def.js', sizes.preloaded);
  write('chart-ghi.js', sizes.lazy);
  writeFileSync(
    join(dist, 'index.html'),
    `<!doctype html><html><head>
<script type="module" crossorigin src="${base}assets/index-abc.js"></script>
<link rel="modulepreload" crossorigin href="${base}assets/vendor-def.js">
<link rel="icon" href="${base}favicon.ico">
</head><body></body></html>`,
  );
  return dist;
}

function check(dist: string) {
  const run = spawnSync(process.execPath, [SCRIPT, dist], {encoding: 'utf8'});
  rmSync(dist, {recursive: true, force: true});
  return {code: run.status, output: run.stdout + run.stderr};
}

test('passes when the entry and its preloaded chunks are within 250 KB Brotli', () => {
  const {code, output} = check(builtApp({entry: 140_000, preloaded: 80_000, lazy: 400_000}));

  expect(output).toMatch(/Entry JavaScript: 2 files, 2\d\d\.\d KB Brotli \(limit 250 KB\)/);
  expect(code).toBe(0);
});

test('fails when the entry and its preloaded chunks are over 250 KB Brotli', () => {
  const {code, output} = check(builtApp({entry: 200_000, preloaded: 80_000, lazy: 1_000}));

  expect(output).toContain('over the 250 KB limit');
  expect(output).toContain('assets/index-abc.js');
  expect(output).toContain('assets/vendor-def.js');
  expect(code).toBe(1);
});

test('reads an app built under a base path', () => {
  const {code, output} = check(builtApp({entry: 1_000, preloaded: 1_000, lazy: 1_000}, '/app/'));

  expect(output).toContain('Entry JavaScript: 2 files');
  expect(code).toBe(0);
});

test('fails when the build names no entry script', () => {
  const dist = mkdtempSync(join(tmpdir(), 'entry-size-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><html></html>');

  const {code, output} = check(dist);

  expect(output).toContain('no entry script');
  expect(code).toBe(1);
});
