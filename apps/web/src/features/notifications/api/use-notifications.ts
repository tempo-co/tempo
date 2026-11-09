import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import type {
  NotificationPreferencesUpdate,
  NotificationSettings,
  PushSubscriptionRemoval,
} from '@tempo/contracts';
import {toast} from 'sonner';

import {
  NotificationPermissionError,
  getDeviceSubscription,
  subscribeDevice,
  toRegistration,
  unsubscribeDevice,
} from '@/features/notifications/utils/push-device';
import {api, wasToasted} from '@/utils/api';

const SETTINGS_KEY = ['notifications'] as const;
const DEVICE_KEY = ['notifications', 'device'] as const;
const SUBSCRIPTIONS = '/notifications/subscriptions';

/** The owner's alert choices and the key this browser subscribes with. */
export function useNotificationSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api.get<NotificationSettings>('/notifications'),
  });
}

/** Saves the alert choice, showing it at once and putting it back if the save fails. */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: NotificationPreferencesUpdate) =>
      api.patch<NotificationSettings>('/notifications/preferences', update),
    onMutate: async (update) => {
      await queryClient.cancelQueries({queryKey: SETTINGS_KEY, exact: true});
      const previous = queryClient.getQueryData<NotificationSettings>(SETTINGS_KEY);
      if (previous) {
        queryClient.setQueryData<NotificationSettings>(SETTINGS_KEY, {
          ...previous,
          preferences: {...previous.preferences, ...update},
        });
      }
      return {previous};
    },
    onSuccess: (settings) => queryClient.setQueryData(SETTINGS_KEY, settings),
    onError: (error, _update, context) => {
      if (context?.previous) queryClient.setQueryData(SETTINGS_KEY, context.previous);
      if (!wasToasted(error)) toast.error('The alert setting could not be saved.');
    },
  });
}

/** Whether this browser gets alerts: the endpoint of its subscription, or null. */
export function useDeviceSubscription() {
  return useQuery({
    queryKey: DEVICE_KEY,
    queryFn: async () => (await getDeviceSubscription())?.endpoint ?? null,
    // The browser holds the answer, so it needs no connection and nothing is saved for offline use.
    networkMode: 'always',
    gcTime: 0,
  });
}

/** Asks for permission and subscribes this browser. Only call it from a click. */
export function useAllowNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (publicKey: string) => {
      const registration = await subscribeDevice(publicKey);
      await api.put(SUBSCRIPTIONS, registration);
      return registration.endpoint;
    },
    onSuccess: (endpoint) => queryClient.setQueryData(DEVICE_KEY, endpoint),
    onError: (error) => {
      // A refused permission is shown on the settings screen itself.
      if (error instanceof NotificationPermissionError || wasToasted(error)) return;
      toast.error('Notifications could not be turned on for this device.');
    },
  });
}

/** Unsubscribes this browser and removes it from Tempo. */
export function useTurnOffNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const endpoint = await unsubscribeDevice();
      if (endpoint) {
        await api.delete(SUBSCRIPTIONS, {endpoint} satisfies PushSubscriptionRemoval);
      }
    },
    onSettled: () => queryClient.invalidateQueries({queryKey: DEVICE_KEY}),
    onError: (error) => {
      if (!wasToasted(error)) toast.error('Notifications could not be turned off for this device.');
    },
  });
}

/**
 * Registers this browser's existing subscription with the signed-in session, so a device that was signed in again
 * after its session ended keeps getting alerts. Logging out ends the subscription, so it then registers nothing.
 */
export async function registerExistingSubscription() {
  const subscription = await getDeviceSubscription();
  if (subscription) await api.put(SUBSCRIPTIONS, toRegistration(subscription));
}
