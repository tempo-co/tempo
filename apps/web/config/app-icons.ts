/** Icons in `public/`: the PWA manifest lists the install icons; the offline shell caches all. */
export const PWA_ICONS = [
  {file: 'icon-192.png', sizes: '192x192', purpose: 'any'},
  {file: 'icon-512.png', sizes: '512x512', purpose: 'any'},
  {file: 'maskable-512.png', sizes: '512x512', purpose: 'maskable'},
] as const;

/** Linked from `index.html`. */
export const PAGE_ICONS = [
  'favicon.ico',
  'favicon.svg',
  'favicon-16.png',
  'favicon-32.png',
  'favicon-48.png',
  'apple-touch-icon.png',
] as const;
