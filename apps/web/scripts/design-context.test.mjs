import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(root, 'scripts/design-context.mjs');
const run = (cwd, ...args) => spawnSync(process.execPath, [script, ...args], {cwd, encoding: 'utf8'});

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tempo-design-context-'));
  for (const name of ['DESIGN.md', 'PRODUCT.md', 'src', '.impeccable', 'scripts']) {
    cpSync(path.join(root, name), path.join(dir, name), {recursive: true});
  }
  return dir;
}

test('reviewed design context validates by content and reports source changes without writing', () => {
  const dir = fixture();
  try {
    const review = run(dir, '--reviewed');
    assert.equal(review.status, 0, review.stderr);
    assert.equal(run(dir).status, 0);
    const sidecar = path.join(dir, '.impeccable/design.json');
    const before = readFileSync(sidecar, 'utf8');
    // A checkout or touch changes timestamps, not the reviewed content.
    utimesSync(path.join(dir, 'DESIGN.md'), new Date(), new Date());
    assert.equal(run(dir).status, 0);
    const source = path.join(dir, 'src/index.css');
    const time = statSync(source);
    writeFileSync(source, readFileSync(source, 'utf8') + '\n/* synthetic design change */\n');
    utimesSync(source, time.atime, time.mtime);
    const stale = run(dir);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /src\/index\.css/);
    assert.equal(readFileSync(sidecar, 'utf8'), before);
    assert.equal(run(dir, '--reviewed').status, 0);
    assert.equal(run(dir).status, 0);
    // Repeating an acknowledgement does not create timestamp-only churn.
    const reviewed = readFileSync(sidecar, 'utf8');
    assert.equal(run(dir, '--reviewed').status, 0);
    assert.equal(readFileSync(sidecar, 'utf8'), reviewed);
    // Added and removed foundational files also require acknowledgement.
    const added = path.join(dir, 'src/components/ui/synthetic.tsx');
    writeFileSync(added, 'export const synthetic = true;\n');
    assert.match(run(dir).stderr, /synthetic\.tsx/);
    assert.equal(run(dir, '--reviewed').status, 0);
    rmSync(added);
    assert.match(run(dir).stderr, /synthetic\.tsx/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('design context requires parseable frontmatter and a current sidecar schema', () => {
  const dir = fixture();
  try {
    const design = path.join(dir, 'DESIGN.md');
    writeFileSync(design, readFileSync(design, 'utf8').replace(/^---\r?\n/, ''));
    const invalid = run(dir, '--reviewed');
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /frontmatter/);
    for (const token of ['colors.missing', 'colors.toString']) {
      cpSync(path.join(root, 'DESIGN.md'), design);
      writeFileSync(design, readFileSync(design, 'utf8').replace('{colors.primary}', `{${token}}`));
      for (const args of [['--reviewed'], []]) {
        const reference = run(dir, ...args);
        assert.equal(reference.status, 1);
        assert.ok(reference.stderr.includes(token));
      }
    }
    cpSync(path.join(root, 'DESIGN.md'), design);
    const sidecar = path.join(dir, '.impeccable/design.json');
    const data = JSON.parse(readFileSync(sidecar, 'utf8'));
    data.schemaVersion = 1;
    writeFileSync(sidecar, JSON.stringify(data));
    const schema = run(dir, '--reviewed');
    assert.equal(schema.status, 1);
    assert.match(schema.stderr, /schemaVersion/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

for (const [name, alter, message] of [
  ['color values', (data) => {data.extensions.colorMeta.primary.canonical = '#000000';}, /colorMeta\.primary/],
  ['typography references', (data) => {data.extensions.typographyMeta.synthetic = {};}, /typographyMeta\.synthetic/],
  ['component references', (data) => {data.components[0].refersTo = 'synthetic';}, /has no DESIGN\.md token/],
]) {
  test(`inconsistent ${name} require correction before review acknowledgement`, () => {
    const dir = fixture();
    try {
      const sidecar = path.join(dir, '.impeccable/design.json');
      const data = JSON.parse(readFileSync(sidecar, 'utf8'));
      alter(data);
      const before = JSON.stringify(data);
      writeFileSync(sidecar, before);
      const result = run(dir, '--reviewed');
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
      assert.equal(readFileSync(sidecar, 'utf8'), before);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
}
