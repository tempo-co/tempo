import {useQueryClient} from '@tanstack/react-query';
import type {PushSubscriptionRegistration} from '@tempo/contracts';
import {useEffect} from 'react';

import {
  getDeviceSubscription,
  getPushSupport,
  isDeviceTurnedOff,
  subscribeAllowedDevice,
  unsubscribeDevice,
} from '@/features/notifications/utils/push-device';
import {api, getSessionSignal} from '@/utils/api';

import {
  DEVICE_KEY,
  SUBSCRIPTIONS,
  useDeviceSubscription,
  useNotificationSettings,
} from './use-notifications';

/**
 * Subscribes this browser again without asking when notifications are still allowed but its subscription is gone
 * (clearing site data on Android removes the subscription and keeps the permission). It runs once Tempo answers with
 * the alert settings, and again when bank alerts are turned on, but not for a device that was turned off. Only a device
 * that could be restored asks Tempo for the settings, so other devices, and the moment logout clears the session,
 * read nothing. Failures stay silent and leave the device off, so Allow notifications still works. An attempt that
 * logout or bank alerts going off interrupts registers nothing and ends any subscription it got.
 */
export function useRestoreDeviceSubscription(confirmed: boolean) {
  const queryClient = useQueryClient();
  const device = useDeviceSubscription();
  const restorable =
    device.data === null &&
    getPushSupport() === 'supported' &&
    Notification.permission === 'granted' &&
    !isDeviceTurnedOff();
  const {data: settings} = useNotificationSettings({enabled: restorable, background: true});
  // Logout clears the confirmed session, so settings put back after it, by a failed save's rollback, start nothing.
  const publicKey = confirmed && settings?.preferences.bankConnections ? settings.publicKey : null;

  useEffect(() => {
    if (!publicKey) return;
    let stopped = false;
    // Logging out cancels this signal before the signed-in layout unmounts.
    const signal = getSessionSignal();
    const isStopped = () => stopped || signal.aborted;
    void (async () => {
      if (getPushSupport() !== 'supported' || Notification.permission !== 'granted') return;
      if (isDeviceTurnedOff() || (await getDeviceSubscription())) return;
      await navigator.serviceWorker.ready;
      if (isStopped()) return;
      const registration = await subscribeAllowedDevice(publicKey, isStopped);
      if (!isStopped()) {
        // Settings shows the device as on while Tempo registers it, so Allow is not offered meanwhile.
        queryClient.setQueryData(DEVICE_KEY, registration.endpoint);
        const registered = await api
          .put(SUBSCRIPTIONS, registration satisfies PushSubscriptionRegistration, {quiet: true})
          .then(
            () => true,
            () => false,
          );
        if (registered) return;
      }
      await unsubscribeDevice();
      await queryClient.invalidateQueries({queryKey: DEVICE_KEY});
    })().catch(() => {
      /* The browser refused, as iPhone and iPad may outside a click: Allow notifications still works. */
    });
    return () => {
      stopped = true;
    };
  }, [publicKey, queryClient]);
}
