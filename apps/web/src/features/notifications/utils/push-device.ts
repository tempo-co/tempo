import type {PushSubscriptionRegistration} from '@tempo/contracts';

/**
 * Whether this browser can get Tempo's alerts, and if not, what would change that. iPhone and iPad deliver web push
 * only to apps added to the Home Screen on iOS 16.4 or later; on Android Tempo asks to be installed first, so alerts
 * open the app rather than a browser tab.
 */
export type PushSupport =
  'supported' | 'ios-add-to-home-screen' | 'ios-update' | 'android-install' | 'unsupported';

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & {standalone?: boolean}).standalone === true
  );
}

/** The iOS version an iPhone or iPad reports as major * 100 + minor (16.4 is 1604), or null for other devices. */
function iosVersion(): number | null {
  const ua = navigator.userAgent;
  // iPadOS reports a Mac user agent; a touch screen tells them apart.
  const isIos =
    /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (!isIos) return null;
  const match = /OS (\d+)[_.](\d+)/.exec(ua) ?? /Version\/(\d+)\.(\d+)/.exec(ua);
  return match ? Number(match[1]) * 100 + Number(match[2]) : null;
}

export function getPushSupport(): PushSupport {
  const ios = iosVersion();
  if (ios !== null && ios < 1604) return 'ios-update';
  if (ios !== null && !isStandalone()) return 'ios-add-to-home-screen';
  if (/Android/.test(navigator.userAgent) && !isStandalone()) return 'android-install';
  const capable =
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
  return capable ? 'supported' : 'unsupported';
}

/**
 * The app icon shows `count`; nothing at zero. Only installed desktop Chrome and Edge and iPhone Home Screen apps
 * have the Badging API; other browsers are left alone.
 */
export function setAppBadge(count: number) {
  if (!('setAppBadge' in navigator)) return;
  const request = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
  void request.catch(() => {
    /* The badge is a hint; a refused badge changes nothing else. */
  });
}

async function getRegistration() {
  if (!('serviceWorker' in navigator)) return undefined;
  return navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
}

/** This browser's push subscription for Tempo, if it has one and notifications are still allowed. */
export async function getDeviceSubscription(): Promise<PushSubscription | null> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return null;
  const registration = await getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export class NotificationPermissionError extends Error {
  constructor(public permission: NotificationPermission) {
    super('Notifications are not allowed.');
  }
}

function toKey(base64url: string) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
  return Uint8Array.from(bytes, (char) => char.charCodeAt(0));
}

/**
 * Asks for permission (call it from a click: browsers only ask in response to one) and subscribes this browser with
 * the server's key. Resolves to what the API stores.
 */
export async function subscribeDevice(publicKey: string): Promise<PushSubscriptionRegistration> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new NotificationPermissionError(permission);
  return subscribeAllowedDevice(publicKey);
}

/**
 * Subscribes this browser without asking, once notifications are allowed. iPhone and iPad may refuse it outside a
 * click.
 */
export async function subscribeAllowedDevice(
  publicKey: string,
  isStopped = () => false,
): Promise<PushSubscriptionRegistration> {
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return toRegistration(existing);
  // Logout can end an attempt while the browser answers; a stopped attempt creates no subscription.
  if (isStopped()) throw new Error('The subscription attempt was stopped.');
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: toKey(publicKey),
  });
  return toRegistration(subscription);
}

export function toRegistration(subscription: PushSubscription): PushSubscriptionRegistration {
  const {endpoint, keys} = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth)
    throw new Error('The browser returned no push keys.');
  return {endpoint, keys: {p256dh: keys.p256dh, auth: keys.auth}};
}

/** Ends this browser's subscription; resolves to the endpoint it had, if any. */
export async function unsubscribeDevice(): Promise<string | null> {
  const registration = await getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return null;
  await subscription.unsubscribe();
  return subscription.endpoint;
}

const TURNED_OFF_KEY = 'tempo-device-alerts-off';

/**
 * Whether this device was turned off in Settings, so Tempo leaves it unsubscribed until Allow is tapped. Unreadable
 * storage counts as turned off: the choice can't be known, so Tempo doesn't subscribe on its own.
 */
export function isDeviceTurnedOff() {
  try {
    return localStorage.getItem(TURNED_OFF_KEY) === 'true';
  } catch {
    return true;
  }
}

export function setDeviceTurnedOff(turnedOff: boolean) {
  try {
    if (turnedOff) localStorage.setItem(TURNED_OFF_KEY, 'true');
    else localStorage.removeItem(TURNED_OFF_KEY);
  } catch {
    /* Without storage the choice is not remembered; the subscription itself still ends or starts. */
  }
}
