import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import type {Plugin, Rolldown} from 'vite';

import {PAGE_ICONS, PWA_ICONS} from './app-icons';

/**
 * The bank picker's country flags (flag-icons) stay out of the cache: the browser downloads only the ones the picker
 * shows, and connecting a bank needs the network anyway.
 */
function isCountryFlag(output: Rolldown.OutputBundle[string]) {
  return (
    output.type === 'asset' &&
    output.originalFileNames.length > 0 &&
    output.originalFileNames.every((name) => /(?:^|\/)node_modules\/flag-icons\/flags\//.test(name))
  );
}

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
            (/^assets\/.+\.(?:js|css|woff2?|png|svg)$/.test(name) && !isCountryFlag(bundle[name])),
        )
        .sort();
      for (const name of files) {
        const output = bundle[name];
        hash.update(name).update(output.type === 'chunk' ? output.code : output.source);
      }
      for (const name of [...PAGE_ICONS, ...PWA_ICONS.map((icon) => icon.file)]) {
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
// The app icon shows how many transactions need review; browsers without the Badging API ignore it.
async function setBadge(count) {
  try {
    if (count > 0) await self.navigator.setAppBadge?.(count);
    else await self.navigator.clearAppBadge?.();
  } catch { /* Badging is best effort. */ }
}
// Only Tempo's own pages open from a notification.
function appUrl(url) {
  try {
    const target = new URL(url, self.location.origin);
    if (target.origin === self.location.origin && target.pathname.startsWith(BASE)) return target.href;
  } catch { /* Fall back to the app's start page. */ }
  return new URL(BASE, self.location.origin).href;
}
self.addEventListener('push', (event) => {
  let alert = {};
  try { alert = event.data ? event.data.json() : {}; } catch { /* Show the plain alert. */ }
  event.waitUntil(Promise.all([
    typeof alert.badge === 'number' ? setBadge(alert.badge) : undefined,
    self.registration.showNotification(alert.title || 'Tempo', {
      body: alert.body || '',
      tag: alert.tag,
      icon: BASE + 'pwa-icon-192.png',
      data: {url: appUrl(alert.url || BASE)},
    }),
  ]));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = appUrl(event.notification.data?.url || BASE);
  const open = (async () => {
    const windows = await self.clients.matchAll({type: 'window'});
    const client = windows.find((window) => new URL(window.url).pathname.startsWith(BASE));
    if (client) {
      // Navigate first: focusing needs the click's user activation, navigating does not.
      const navigated = await client.navigate(url).catch(() => null);
      await (navigated || client).focus().catch(() => undefined);
      if (navigated) return;
    }
    await self.clients.openWindow(url);
  })();
  event.waitUntil(open);
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
        // Revalidate: a stale index.html from the HTTP cache would point at deleted assets.
        const response = await fetch(request, {cache: 'no-cache', signal: AbortSignal.timeout(5000)});
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
