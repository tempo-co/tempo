import type {Session} from '@tempo/contracts';

import {Button, ButtonProps} from '@/components/ui/button';

import {useRevokeSession} from '../../api/use-revoke-session';
import {ConfirmActionDialog} from './confirm-action-dialog';

type SessionRevokeDialogProps = {
  session: Session;
  triggerVariant?: ButtonProps['variant'];
};

export function SessionRevokeDialog({
  session,
  triggerVariant = 'outline',
}: SessionRevokeDialogProps) {
  const {revokeSession, isPending} = useRevokeSession();

  return (
    <ConfirmActionDialog
      trigger={
        <Button
          variant={triggerVariant}
          className='min-w-20 max-sm:h-11'
          size='sm'
          data-testid='revoke-session-button'
        >
          Revoke
        </Button>
      }
      title='Revoke access'
      description={
        <>
          Revoke <span className='text-foreground'>{session.name}</span>?
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
