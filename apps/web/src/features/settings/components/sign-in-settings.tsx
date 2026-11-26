import {Button} from '@/components/ui/button';
import {useLogOut} from '@/hooks/use-logout';

import {PasswordChangeDialog} from './password-change/password-change-dialog';
import {SettingsGroup, SettingsList, SettingsRow} from './settings-group';

/** The password, and logging out of this device: it works even when the session list can't load. */
export function SignInSettings() {
  const {logOut, isPending} = useLogOut();

  return (
    <SettingsGroup id='sign-in-heading' title='Sign-in'>
      <SettingsList>
        <SettingsRow label='Password' action={<PasswordChangeDialog />} />
        <SettingsRow
          label='Log out'
          value='End your session on this device.'
          action={
            <Button
              variant='outline'
              size='sm'
              className='min-w-20 max-sm:h-11'
              onClick={() => void logOut()}
              disabled={isPending}
              data-testid='log-out-button'
            >
              Log out
            </Button>
          }
        />
      </SettingsList>
    </SettingsGroup>
  );
}
