import {useState} from 'react';

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

import {useRevokePersonalAccessToken} from '../../api/use-personal-access-tokens';
import {PersonalAccessToken} from '../../types/personal-access-token';

type RevokeTokenDialogProps = {
  token: PersonalAccessToken;
  triggerVariant?: ButtonProps['variant'];
};

export function RevokeTokenDialog({token, triggerVariant = 'outline'}: RevokeTokenDialogProps) {
  const [open, setOpen] = useState(false);
  const revoke = useRevokePersonalAccessToken();
  const confirm = async () => {
    try {
      await revoke.mutateAsync(token.id);
      setOpen(false);
    } catch {
      // Keep the confirmation open and the token listed when revocation fails.
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!revoke.isPending) revoke.reset();
        setOpen(nextOpen);
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
        {revoke.isError && (
          <ResponsiveDialogBody>
            <p role='alert' className='text-sm text-destructive'>
              The token could not be revoked. Please try again.
            </p>
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
