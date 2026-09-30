import {Button, ButtonProps} from '@/components/ui/button';
import {useLogOut} from '@/hooks/use-logout';

import {ConfirmActionDialog} from './confirm-action-dialog';

type LogOutDialogProps = {
  triggerVariant?: ButtonProps['variant'];
};

export function LogOutDialog({triggerVariant = 'ghost'}: LogOutDialogProps) {
  const {logOut, isPending} = useLogOut();

  return (
    <ConfirmActionDialog
      trigger={
        <Button
          variant={triggerVariant}
          className='min-h-11 w-fit text-foreground'
          size='sm'
          data-testid='log-out-button-session'
        >
          Log out
        </Button>
      }
      title='Log out?'
      description='You will be logged out from this session.'
      confirmLabel='Log out'
      pendingLabel='Logging out...'
      confirmTestId='log-out-button-session-confirm'
      isPending={isPending}
      onConfirm={logOut}
    />
  );
}
