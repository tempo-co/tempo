import type {PersonalAccessToken} from '@tempo/contracts';
import {CircleAlert} from 'lucide-react';
import {useRef, useState} from 'react';
import {toast} from 'sonner';

import {Alert, AlertDescription} from '@/components/ui/alert';
import {Button, ButtonProps} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';
import {wasToasted} from '@/utils/api';

import {useRevokePersonalAccessToken} from '../../api/use-personal-access-tokens';

type RevokeTokenDialogProps = {
  token: PersonalAccessToken;
  triggerVariant?: ButtonProps['variant'];
};

export function RevokeTokenDialog({token, triggerVariant = 'outline'}: RevokeTokenDialogProps) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const changeOpen = (nextOpen: boolean) => {
    openRef.current = nextOpen;
    setOpen(nextOpen);
  };
  const revoke = useRevokePersonalAccessToken();
  const confirm = async () => {
    try {
      await revoke.mutateAsync(token.id);
      changeOpen(false);
    } catch (error) {
      // The token stays listed. An open confirmation shows the failure itself; a closed one toasts it.
      if (!openRef.current && !wasToasted(error)) toast.error('The token could not be revoked.');
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!revoke.isPending) revoke.reset();
        changeOpen(nextOpen);
      }}
    >
      <ResponsiveDialogTrigger asChild>
        <Button
          variant={triggerVariant}
          size='sm'
          aria-label={`Revoke ${token.name}`}
          className='min-w-20 max-sm:h-11'
        >
          Revoke
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className='md:max-w-132'>
        <ResponsiveDialogHeader className='text-start'>
          <ResponsiveDialogTitle>Revoke access token</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Revoke <span className='wrap-anywhere text-foreground'>{token.name}</span>? Any client
            using this token will lose access immediately.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {revoke.isError && !wasToasted(revoke.error) && (
          <ResponsiveDialogBody>
            <Alert role='alert' variant='destructive'>
              <CircleAlert aria-hidden='true' />
              <AlertDescription className='text-foreground'>
                The token could not be revoked. Try again.
              </AlertDescription>
            </Alert>
          </ResponsiveDialogBody>
        )}
        <ResponsiveDialogFooter className='gap-2'>
          <Button
            variant='destructive'
            disabled={revoke.isPending}
            onClick={() => void confirm()}
            className='order-1 max-sm:h-11 md:order-2'
          >
            {revoke.isPending ? 'Revoking…' : 'Revoke token'}
          </Button>
          <ResponsiveDialogClose asChild>
            <Button variant='outline' className='order-2 max-sm:h-11 md:order-1'>
              {revoke.isPending ? 'Close' : 'Cancel'}
            </Button>
          </ResponsiveDialogClose>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
