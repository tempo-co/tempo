# PWA and offline shell

## Where the manifest comes from

The build emits `manifest.webmanifest` from `pwaManifestPlugin` in `vite.config.ts`, using `VITE_BASE_PATH` for `id`, `start_url`, `scope` and every icon `src`. It overwrites `public/manifest.webmanifest`, which is a root-path copy for `vite dev`. Icon lists come from `config/app-icons.ts` (`PWA_ICONS` for the manifest, `PAGE_ICONS` for `index.html`). When changing names, colours or icons, change the plugin and `config/app-icons.ts`, and keep `public/manifest.webmanifest` in step.

`index.html` links icons and the manifest with `%BASE_URL%`, so they follow `base`. `id` is set explicitly: without it the browser derives the app identity from `start_url`, and two apps on one origin would share an identity.

## Offline shell

`config/offline-shell.ts` emits `sw.js` at build time only (`apply: 'build'`). It caches `index.html`, the manifest, the hashed assets and every icon in `config/app-icons.ts`, under a cache name hashed from those files and the base path. It requires a base path that starts and ends with `/`. The bank picker's country flags (the `flag-icons` package, about 270 SVGs) are hashed assets left out of the cache: the browser downloads only the flags the picker shows, and connecting a bank needs the network anyway.

`src/utils/register-offline-shell.ts` registers it only when `import.meta.env.PROD`, in a secure context. A build with `NODE_ENV=test` does not register it (see `docs/env-boundaries.md`), and the offline specs wait for `navigator.serviceWorker.controller`.

A new file in `public/` that the app needs offline must be added to `config/app-icons.ts` or matched by the asset filter in `config/offline-shell.ts`.

## Push alerts and the app badge

`sw.js` also handles `push` and `notificationclick`. A push carries `{title, body, url, tag, badge}`: the worker shows the notification, sets or clears the app badge from `badge`, and a click navigates an open Tempo window to `url` (or opens one). Only URLs on this origin under the base path open; anything else opens the start page.

- Settings → Account → Notifications asks for permission only from its Allow notifications button; browsers refuse a prompt that no click started. `src/features/notifications/utils/push-device.ts` decides what the device supports: iPhone and iPad need a Home Screen app on iOS 16.4 or later, and Android asks for the installed app.
- While Tempo is open, the badge is the review-counts `needsAttention` (the Transactions tab's count) and clears at sign-out. The Badging API exists in installed desktop Chrome and Edge and in iOS Home Screen apps with notification permission; Android Chrome has none.
- Logging out unsubscribes the browser; the API also removes that session's subscriptions. A browser that is still subscribed registers itself with the session again when Tempo opens, so a session that expired does not end its alerts.
- `test/e2e/settings/notification-alerts.spec.ts` drives the worker through Chromium DevTools in full Chromium (the headless shell denies notifications); WebKit skips it.

## Verifying a served build

Check the served URLs, not the source:

1. The document's `link[rel=manifest]` points at the manifest under the served base path.
2. The manifest parses and its `id`, `start_url` and `scope` match the served base path.
3. Every icon URL returns an image with the declared size. A wrong path returns the SPA's `index.html` with 200 (`try_files` in `nginx/tempo.conf`), which Chrome reports as `no-acceptable-icon`.
4. In Chromium, CDP `Page.getAppId` shows the resolved identity and `Page.getInstallabilityErrors` lists manifest and icon problems.

An installed shortcut keeps the old manifest's identity; remove it and install again after changing `id` or `start_url`.

## iOS home-screen apps

CI runs Chromium only (`playwright.config.ts` has one `chromium` project), so iOS behaviour is untested. Known gaps:

- `env(safe-area-inset-*)` is 0 unless the viewport meta has `viewport-fit=cover`; `index.html` does not set it.
- Push and the app badge need the Home Screen app, notification permission and iOS 16.4 or later; check them on a device.
- Installed web apps on iOS do not capture links. A bank login that hands off to another app usually returns to Safari, which has its own cookie jar. The API's bank callback is public and state-based, so the connection is saved, but Safari then shows the login page; reopen the home-screen app.
