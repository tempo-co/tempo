import {Button} from '@/components/ui/button';

import {useRevokeAllSessions} from '../../api/use-revoke-all-sessions';
import {ConfirmActionDialog} from './confirm-action-dialog';

export function SessionRevokeAllDialog() {
  const {revokeAllSessions, isPending} = useRevokeAllSessions();

  return (
    <ConfirmActionDialog
      trigger={
        <Button
          variant='ghost'
          className='min-h-11 w-fit text-foreground sm:min-h-9'
          size='sm'
          data-testid='revoke-all-sessions-button'
        >
          Revoke all
        </Button>
      }
      title='Revoke access'
      description='Revoke all other sessions? This cannot be undone.'
      confirmLabel='Revoke'
      pendingLabel='Revoking...'
      confirmVariant='destructive'
      confirmTestId='revoke-all-sessions-button-confirm'
      isPending={isPending}
      onConfirm={revokeAllSessions}
    />
  );
}
