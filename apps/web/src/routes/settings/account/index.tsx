import {createFileRoute} from '@tanstack/react-router';

import {Skeleton} from '@/components/ui/skeleton';
import {NotificationSettings} from '@/features/notifications/components/notification-settings';
import {AccountDelete} from '@/features/settings/components/account-delete/account-delete';
import {EmailChangeDialog} from '@/features/settings/components/email-change/email-change-dialog';
import {NameChangeDialog} from '@/features/settings/components/name-change-dialog';
import {
  SettingsGroup,
  SettingsList,
  SettingsRow,
} from '@/features/settings/components/settings-group';
import {TimeZoneDialog} from '@/features/settings/components/time-zone-dialog';
import {formatTimeZone} from '@/features/settings/utils/time-zones';
import {useCurrentAccount} from '@/hooks/use-current-account';

export const Route = createFileRoute('/settings/account/')({
  component: SettingsAccountIndex,
});

function SettingsAccountIndex() {
  const {currentAccount} = useCurrentAccount({skipFetch: true});

  if (!currentAccount) {
    return <Skeleton className='h-72 w-full rounded-card bg-card' />;
  }

  return (
    <div className='space-y-10'>
      <SettingsGroup id='profile-heading' title='Profile'>
        <SettingsList>
          <SettingsRow
            label='Name'
            value={currentAccount.name}
            action={<NameChangeDialog currentName={currentAccount.name} />}
          />
          <SettingsRow
            label='Email'
            value={currentAccount.email}
            action={<EmailChangeDialog currentEmail={currentAccount.email} />}
          />
          <SettingsRow
            label='Time zone'
            value={
              <span data-testid='account-time-zone'>{formatTimeZone(currentAccount.timeZone)}</span>
            }
            action={<TimeZoneDialog currentTimeZone={currentAccount.timeZone} />}
          />
        </SettingsList>
      </SettingsGroup>

      <NotificationSettings />

      <AccountDelete />
    </div>
  );
}
