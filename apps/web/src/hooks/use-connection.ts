import {onlineManager} from '@tanstack/react-query';
import {useEffect, useSyncExternalStore} from 'react';

import {completePendingLogout} from '@/utils/api';

onlineManager.setOnline(navigator.onLine);
const subscribe = (listener: () => void) => onlineManager.subscribe(listener);
const getSnapshot = () => onlineManager.isOnline();

/** Whether Tempo answered its most recent request. */
export function useIsOnline() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Tracks reachability and probes Tempo until it answers again. Mount once, at the app root. */
export function useConnection() {
  const isOnline = useIsOnline();
  useEffect(() => {
    if (isOnline) {
      void completePendingLogout().catch(() => {
        // Keep the pending marker; API calls cannot trust the old session until logout succeeds.
      });
      return;
    }
    const controller = new AbortController();
    let checking = false;
    const check = async () => {
      if (checking || !navigator.onLine) return;
      checking = true;
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/health`, {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        });
        if (response.ok && !controller.signal.aborted) onlineManager.setOnline(true);
      } catch {
        /* Keep saved data visible until a probe succeeds. */
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => void check(), 10000);
    window.addEventListener('focus', check);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [isOnline]);
  return isOnline;
}
