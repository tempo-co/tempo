import {createFileRoute} from '@tanstack/react-router';

import {Skeleton} from '@/components/ui/skeleton';
import {ReportingCurrencyRow} from '@/features/reporting-currency/components/reporting-currency-row';
import {EmailChangeDialog} from '@/features/settings/components/email-change/email-change-dialog';
import {NameChangeDialog} from '@/features/settings/components/name-change-dialog';
import {SettingsList, SettingsRow} from '@/features/settings/components/settings-group';
import {TimeZoneDialog} from '@/features/settings/components/time-zone-dialog';
import {formatTimeZone} from '@/features/settings/utils/time-zones';
import {useCurrentAccount} from '@/hooks/use-current-account';

export const Route = createFileRoute('/settings/profile/')({
  component: SettingsProfile,
});

function SettingsProfile() {
  const {currentAccount} = useCurrentAccount({skipFetch: true});

  if (!currentAccount) {
    return <Skeleton className='h-64 w-full rounded-lg bg-card' />;
  }

  return (
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
      <ReportingCurrencyRow />
    </SettingsList>
  );
}
