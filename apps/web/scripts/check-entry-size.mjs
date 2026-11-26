// Fails the web build when the JavaScript a first visit loads before the app can start (the entry
// script and the chunks index.html preloads with it) is over the budget, Brotli-compressed.
// Usage: node scripts/check-entry-size.mjs [dist]
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {brotliCompressSync} from 'node:zlib';

const LIMIT_KB = 250;
const dist = process.argv[2] ?? 'dist';

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const tags = [
  ...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g),
  ...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g),
];
// Vite names every built file under assets/, whatever the base path in front of it.
const files = tags.map(([, url]) => url.slice(url.lastIndexOf('assets/')));

if (!files.some((file) => file.startsWith('assets/'))) {
  console.error(`${join(dist, 'index.html')} names no entry script.`);
  process.exit(1);
}

const sizes = files.map((file) => ({
  file,
  kb: brotliCompressSync(readFileSync(join(dist, file))).length / 1000,
}));
const total = sizes.reduce((sum, {kb}) => sum + kb, 0);
const summary = `Entry JavaScript: ${files.length} files, ${total.toFixed(1)} KB Brotli (limit ${LIMIT_KB} KB)`;

if (total > LIMIT_KB) {
  console.error(`${summary}: over the ${LIMIT_KB} KB limit.`);
  for (const {file, kb} of sizes.sort((a, b) => b.kb - a.kb))
    console.error(`  ${kb.toFixed(1).padStart(7)} KB  ${file}`);
  process.exit(1);
}
console.log(summary);
