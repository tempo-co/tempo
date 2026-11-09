import {BellRing} from 'lucide-react';
import {useState} from 'react';

import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Skeleton} from '@/components/ui/skeleton';
import {
  SettingsGroup,
  SettingsList,
  SettingsRow,
} from '@/features/settings/components/settings-group';

import {
  useAllowNotifications,
  useDeviceSubscription,
  useNotificationSettings,
  useTurnOffNotifications,
  useUpdateNotificationPreferences,
} from '../api/use-notifications';
import {NotificationPermissionError, type PushSupport, getPushSupport} from '../utils/push-device';

/** Why this device cannot get alerts, in the words of what to do about it. */
const UNSUPPORTED: Record<Exclude<PushSupport, 'supported'>, string> = {
  'ios-add-to-home-screen':
    'On iPhone and iPad, add Tempo to your Home Screen first: tap Share, then Add to Home Screen, and open Tempo from there.',
  'ios-update': 'Notifications need iOS 16.4 or later. Update this device to turn them on.',
  'android-install':
    'On Android, install Tempo first: open the browser menu, choose Install app, and open Tempo from your home screen.',
  unsupported: 'This browser can’t show notifications from Tempo.',
};

function currentPermission(): NotificationPermission | null {
  return 'Notification' in window ? Notification.permission : null;
}

function ThisDevice({publicKey}: {publicKey: string | null}) {
  const [support] = useState(getPushSupport);
  const [permission, setPermission] = useState(currentPermission);
  const device = useDeviceSubscription();
  const allow = useAllowNotifications();
  const turnOff = useTurnOffNotifications();

  let status: string;
  let action = null;
  if (!publicKey) {
    status = 'This Tempo server isn’t set up to send notifications.';
  } else if (support !== 'supported') {
    status = UNSUPPORTED[support];
  } else if (permission === 'denied') {
    status =
      'Notifications are blocked for Tempo. Allow them in this browser’s site settings, then come back here.';
  } else if (device.isPending) {
    return <Skeleton className='h-16 w-full rounded-card border bg-card' />;
  } else if (device.data) {
    status = 'On. Alerts you have turned on arrive here.';
    action = (
      <Button
        variant='outline'
        size='sm'
        className='max-sm:h-11'
        disabled={turnOff.isPending}
        onClick={() => turnOff.mutate()}
      >
        {turnOff.isPending ? 'Turning off…' : 'Turn off'}
      </Button>
    );
  } else {
    status = 'Off.';
    action = (
      <Button
        size='sm'
        className='max-sm:h-11'
        disabled={allow.isPending}
        onClick={() =>
          allow.mutate(publicKey, {
            onSettled: (_endpoint, error) => {
              setPermission(
                error instanceof NotificationPermissionError
                  ? error.permission
                  : currentPermission(),
              );
            },
          })
        }
      >
        {allow.isPending ? 'Allowing…' : 'Allow notifications'}
      </Button>
    );
  }

  return (
    <SettingsList>
      <SettingsRow
        label='This device'
        value={<span role='status'>{status}</span>}
        action={action}
      />
    </SettingsList>
  );
}

export function NotificationSettings() {
  const {data: settings, isPending, isError, refetch} = useNotificationSettings();
  const update = useUpdateNotificationPreferences();

  if (isPending) return <Skeleton className='h-72 w-full rounded-lg bg-card' />;
  if (isError) {
    return (
      <EmptyState
        icon={BellRing}
        tone='error'
        title='Notification settings could not be loaded.'
        description='Check your connection and try again.'
      >
        <Button variant='outline' onClick={() => void refetch()}>
          Try again
        </Button>
      </EmptyState>
    );
  }

  return (
    <div className='space-y-10'>
      <SettingsGroup
        id='notifications-device-heading'
        title='Notifications'
        description='Tempo only interrupts you when something needs you and can’t wait until you next open it.'
      >
        <ThisDevice publicKey={settings.publicKey} />
        <p className='mt-3 text-sm text-muted-foreground'>
          The app icon shows how many transactions need review when Tempo is installed on a computer
          with Chrome or Edge, or added to an iPhone or iPad Home Screen. Android shows a dot with
          each notification instead.
        </p>
      </SettingsGroup>

      <SettingsGroup
        id='notifications-alerts-heading'
        title='Alerts'
        description='These apply to every device where notifications are on.'
      >
        <SettingsList>
          <label className='flex min-h-16 cursor-pointer items-center gap-4 px-4 py-3'>
            <span className='min-w-0 flex-1'>
              <span className='block text-sm font-medium'>Bank alerts</span>
              <span className='mt-0.5 block text-sm text-muted-foreground'>
                When a bank needs re-authorizing or has stopped syncing
              </span>
            </span>
            <Checkbox
              className='size-5 max-sm:size-6'
              checked={settings.preferences.bankConnections}
              onCheckedChange={(checked) => update.mutate({bankConnections: checked === true})}
            />
          </label>
        </SettingsList>
      </SettingsGroup>
    </div>
  );
}
