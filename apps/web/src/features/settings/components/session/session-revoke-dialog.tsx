import {Button, ButtonProps} from '@/components/ui/button';

import {useRevokeSession} from '../../api/use-revoke-session';
import {Session} from '../../types/session';
import {ConfirmActionDialog} from './confirm-action-dialog';

type SessionRevokeDialogProps = {
  session: Session;
  triggerVariant?: ButtonProps['variant'];
};

export function SessionRevokeDialog({session, triggerVariant = 'ghost'}: SessionRevokeDialogProps) {
  const {revokeSession, isPending} = useRevokeSession();

  return (
    <ConfirmActionDialog
      trigger={
        <Button
          variant={triggerVariant}
          className='min-h-11 w-fit text-foreground'
          size='sm'
          data-testid='revoke-session-button'
        >
          Revoke
        </Button>
      }
      title='Revoke access'
      description={
        <>
          Revoke <span className='text-foreground'>{session.name}</span>? This cannot be undone.
        </>
      }
      contentClassName='md:max-w-132'
      confirmLabel='Revoke'
      pendingLabel='Revoking...'
      confirmVariant='destructive'
      confirmTestId='revoke-session-button-confirm'
      isPending={isPending}
      onConfirm={() => revokeSession({id: session.id})}
    />
  );
}
