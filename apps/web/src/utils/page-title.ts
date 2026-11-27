/** The tab title of Home, sign-in and sign-up, and of every page that names none. */
export const APP_TITLE = 'Wisp';

/** A route's `head`: its tab reads the page's name first, then the app's. */
export function pageHead(page: string) {
  return () => ({meta: [{title: `${page} · ${APP_TITLE}`}]});
}
