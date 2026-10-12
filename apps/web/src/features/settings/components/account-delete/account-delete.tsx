import {Button} from '@/components/ui/button';

import {SettingsList, SettingsRow} from '../settings-group';
import {AccountDeleteDialog} from './account-delete-dialog';

/** A separate one-row group; the confirmation dialog carries the full consequences. */
export function AccountDelete() {
  return (
    <section aria-label='Delete account'>
      <SettingsList>
        <SettingsRow
          label='Delete account'
          value='Permanently removes all your bank data.'
          action={
            <AccountDeleteDialog>
              {/* Red is reserved for the confirmation dialog, where the irreversible step happens. */}
              <Button
                variant='outline'
                size='sm'
                className='min-w-20 max-sm:h-11'
                data-testid='delete-account-button'
              >
                Delete
              </Button>
            </AccountDeleteDialog>
          }
        />
      </SettingsList>
    </section>
  );
}
