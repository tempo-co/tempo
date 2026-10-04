import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import type {Plugin} from 'vite';

export function offlineShellPlugin(base: string): Plugin {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) {
    throw new Error('The offline shell requires a same-origin base path ending in /.');
  }
  return {
    name: 'tempo-offline-shell',
    enforce: 'post',
    apply: 'build',
    generateBundle(_options, bundle) {
      if (!bundle['index.html']) throw new Error('Offline shell is missing index.html.');
      const hash = createHash('sha256');
      const files = Object.keys(bundle)
        .filter(
          (name) =>
            name === 'index.html' ||
            name === 'manifest.webmanifest' ||
            /^assets\/.+\.(?:js|css|woff2?|png|svg)$/.test(name),
        )
        .sort();
      for (const name of files) {
        const output = bundle[name];
        hash.update(name).update(output.type === 'chunk' ? output.code : output.source);
      }
      for (const name of [
        'favicon.svg',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'favicon-48x48.png',
        'apple-touch-icon.png',
        'pwa-icon-192.png',
        'pwa-icon-512.png',
        'maskable-icon-192.png',
        'maskable-icon-512.png',
      ]) {
        hash.update(name).update(readFileSync(path.resolve('public', name)));
        files.push(name);
      }
      const prefix = `tempo-shell-${base}-`;
      const cacheName = prefix + hash.update(base).digest('hex').slice(0, 16);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `
const BASE = ${JSON.stringify(base)};
const PREFIX = ${JSON.stringify(prefix)};
const CACHE = ${JSON.stringify(cacheName)};
const FILES = ${JSON.stringify(files.map((file) => base + file))};
self.addEventListener('install', (event) => {
  // Bypass the HTTP cache: an old index.html stored there would point at assets this cache lacks.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((file) => new Request(file, {cache: 'reload'})))));
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  const relativePath = url.pathname.slice(BASE.length);
  if (relativePath === 'api' || relativePath.startsWith('api/') || relativePath === 'bank-connections/callback') return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, {signal: AbortSignal.timeout(5000)});
        if (response.ok) return response;
      } catch { /* Use the installed shell when the network is unavailable. */ }
      return (await caches.open(CACHE)).match(BASE + 'index.html');
    })());
  } else if (!url.search && FILES.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async (cache) =>
      (await cache.match(url.pathname)) || fetch(request)));
  }
});
`,
      });
    },
  };
}
