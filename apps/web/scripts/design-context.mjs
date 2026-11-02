import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

// These are the sources described by the design system and product record.
// Adding a new foundational surface also means adding its source here.
const sources = [
  'DESIGN.md',
  'PRODUCT.md',
  'src/index.css',
  'src/assets/logo.tsx',
  'src/components/ui',
  'src/components/shared/layout',
  'src/features/dashboard/components',
  'src/routes',
  'scripts/design-context.mjs',
];

function filesAt(name) {
  if (!statSync(name).isDirectory()) return [name];
  return readdirSync(name).sort().flatMap((entry) => filesAt(path.posix.join(name, entry)));
}

try {
  const markdown = readFileSync('DESIGN.md', 'utf8');
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!frontmatter) throw new Error('DESIGN.md needs opening and closing YAML frontmatter delimiters.');
  // js-yaml JSON_SCHEMA accepts data only, not executable/custom YAML tags.
  const tokens = yaml.load(frontmatter[1], {schema: yaml.JSON_SCHEMA});
  if (!tokens?.colors || !tokens?.typography) throw new Error('DESIGN.md frontmatter needs colors and typography.');
  for (const [name, component] of Object.entries(tokens.components)) {
    for (const value of Object.values(component)) {
      const reference = typeof value === 'string' && value.match(/^\{([^}]+)\}$/);
      if (!reference) continue;
      const target = reference[1].split('.').reduce(
        (value, key) => value != null && Object.hasOwn(value, key) ? value[key] : undefined,
        tokens,
      );
      if (target === undefined) {
        throw new Error(`DESIGN.md component ${name} has an undefined token reference: ${reference[1]}.`);
      }
    }
  }
  const sidecarPath = '.impeccable/design.json';
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  if (sidecar.schemaVersion !== 2) throw new Error('design.json needs schemaVersion 2.');
  for (const [key, metadata] of Object.entries(sidecar.extensions.colorMeta)) {
    if (metadata.canonical !== tokens.colors[key]) {
      throw new Error(`design.json colorMeta.${key} does not match DESIGN.md.`);
    }
  }
  for (const key of Object.keys(sidecar.extensions.typographyMeta)) {
    if (!tokens.typography[key]) throw new Error(`design.json typographyMeta.${key} has no DESIGN.md token.`);
  }
  for (const component of sidecar.components) {
    if (!tokens.components[component.refersTo]) throw new Error(`design.json component ${component.name} has no DESIGN.md token.`);
  }
  const sourceHashes = Object.fromEntries(sources.flatMap(filesAt).map((name) => [
    name, createHash('sha256').update(readFileSync(name)).digest('hex'),
  ]));
  const changed = [...new Set([...Object.keys(sourceHashes), ...Object.keys(sidecar.sourceHashes ?? {})])]
    .filter((name) => sourceHashes[name] !== sidecar.sourceHashes?.[name]);
  if (process.argv.includes('--reviewed')) {
    if (changed.length) {
      sidecar.generatedAt = new Date().toISOString();
      sidecar.sourceHashes = sourceHashes;
      writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');
    }
    console.log('Recorded the reviewed design-context sources.');
  } else if (changed.length) {
    throw new Error(`Design context needs review for:\n${changed.join('\n')}\nReview DESIGN.md, PRODUCT.md and .impeccable/design.json against these sources, then run npm run design:reviewed.`);
  } else {
    console.log('Design context matches its reviewed source content.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
