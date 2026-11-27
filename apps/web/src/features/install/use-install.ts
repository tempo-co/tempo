import {useSyncExternalStore} from 'react';

import {
  getInstallPrompt,
  getInstalledHere,
  isAppleMobile,
  isStandalone,
  subscribeInstallPrompt,
} from '@/utils/installed-app';

/**
 * How Wisp can be installed here: `installed` when it runs installed (or was just installed from this page),
 * `steps` on iPhone and iPad (Safari's Share › Add to Home Screen), `prompt` where the browser offered its own install
 * dialog (Chrome), `none` otherwise.
 */
export type InstallWay = 'installed' | 'steps' | 'prompt' | 'none';

export function useInstallWay(): InstallWay {
  const prompt = useSyncExternalStore(subscribeInstallPrompt, getInstallPrompt);
  const installedHere = useSyncExternalStore(subscribeInstallPrompt, getInstalledHere);
  if (installedHere || isStandalone()) return 'installed';
  if (isAppleMobile()) return 'steps';
  return prompt ? 'prompt' : 'none';
}

const DISMISSED_KEY = 'wisp-install-card-dismissed';

function readDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

// Dismissed on this page, for a browser without storage; otherwise storage says, as any tab of this browser left it.
let dismissedHere = false;
const dismissListeners = new Set<() => void>();
const subscribeDismissed = (listener: () => void) => {
  dismissListeners.add(listener);
  // Another tab's dismissal arrives as a storage event.
  const onStorage = (event: StorageEvent) => {
    if (event.key === DISMISSED_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    dismissListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};
const getDismissed = () => dismissedHere || readDismissed();

function dismiss() {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Without storage the card stays hidden until the page reloads.
  }
  dismissedHere = true;
  dismissListeners.forEach((listener) => listener());
}

/** Whether the owner closed Home's install card on this device, which hides it for good. */
export function useInstallCardDismissed() {
  return {dismissed: useSyncExternalStore(subscribeDismissed, getDismissed), dismiss};
}

/**
 * Whether Home offers the install card: on a phone that can install Wisp and does not run it installed, until the
 * owner closes the card on this device.
 */
export function useInstallCard(phone: boolean) {
  const way = useInstallWay();
  const {dismissed} = useInstallCardDismissed();
  return phone && !dismissed && (way === 'steps' || way === 'prompt');
}
