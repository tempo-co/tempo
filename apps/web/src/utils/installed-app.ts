/** Whether Tempo runs as an installed app (from the Home Screen or the app list) rather than in a browser tab. */
export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & {standalone?: boolean}).standalone === true
  );
}

/** An iPhone or iPad; iPadOS reports a Mac user agent, which a touch screen tells apart. */
export function isAppleMobile() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Chrome's install event: `prompt` opens its own install dialog, once per event. */
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>;
};

let installPrompt: InstallPromptEvent | null = null;
let installedHere = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

/**
 * Keeps the browser's install event for Tempo's own Install buttons instead of the browser's banner. Called once at
 * start-up, because the event fires early and only once per page.
 */
export function keepInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installedHere = true;
    changed();
  });
}

export function subscribeInstallPrompt(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The kept install event, null once used or before the browser offers one. */
export const getInstallPrompt = () => installPrompt;
/** Whether Tempo was installed from this page. */
export const getInstalledHere = () => installedHere;

/** Opens the browser's own install dialog; the event is spent either way. */
export async function promptInstall() {
  const event = installPrompt;
  if (!event) return;
  installPrompt = null;
  changed();
  await event.prompt();
}
