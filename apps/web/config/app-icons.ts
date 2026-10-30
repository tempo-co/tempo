/** Icons in `public/`: the PWA manifest lists the install icons; the offline shell caches all. */
export const PWA_ICONS = [
  {file: 'pwa-icon-192.png', sizes: '192x192', purpose: 'any'},
  {file: 'pwa-icon-512.png', sizes: '512x512', purpose: 'any'},
  {file: 'maskable-icon-192.png', sizes: '192x192', purpose: 'maskable'},
  {file: 'maskable-icon-512.png', sizes: '512x512', purpose: 'maskable'},
] as const;

/** Linked from `index.html`. */
export const PAGE_ICONS = [
  'favicon.svg',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'favicon-48x48.png',
  'apple-touch-icon.png',
] as const;
