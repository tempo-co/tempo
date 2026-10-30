import {Button} from '@/components/ui/button';

import {useRevokeAllSessions} from '../../api/use-revoke-all-sessions';
import {ConfirmActionDialog} from './confirm-action-dialog';

export function SessionRevokeAllDialog() {
  const {revokeAllSessions, isPending} = useRevokeAllSessions();

  return (
    <ConfirmActionDialog
      trigger={
        <Button
          variant='outline'
          className='min-w-20 max-sm:h-11'
          size='sm'
          data-testid='revoke-all-sessions-button'
        >
          Log out others
        </Button>
      }
      title='Log out other sessions'
      description='Log out every session except this one?'
      confirmLabel='Log out others'
      pendingLabel='Logging out...'
      confirmVariant='destructive'
      confirmTestId='revoke-all-sessions-button-confirm'
      isPending={isPending}
      onConfirm={revokeAllSessions}
    />
  );
}
