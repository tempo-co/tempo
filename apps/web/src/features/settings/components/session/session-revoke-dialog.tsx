import {Loader} from 'lucide-react';
import {useState} from 'react';

import {Button, ButtonProps} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';

import {useRevokeSession} from '../../api/use-revoke-session';
import {Session} from '../../types/session';

type SessionRevokeDialogProps = {
  session: Session;
  triggerVariant?: ButtonProps['variant'];
};

export function SessionRevokeDialog({session, triggerVariant = 'ghost'}: SessionRevokeDialogProps) {
  const [isOpen, setIsOpen] = useState(false);

  const {revokeSession, isPending} = useRevokeSession();

  const handleRevoke = async () => {
    await revokeSession({id: session.id});
    setIsOpen(false);
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={setIsOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button
          variant={triggerVariant}
          className='w-full text-foreground sm:w-fit'
          size='sm'
          data-testid='revoke-session-button'
        >
          Revoke
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className='md:max-w-[33rem]'>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Revoke access</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='pt-2'>
            Revoke <span className='text-foreground'>{session.name}</span>? This cannot be undone.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter className='flex gap-4'>
          <Button
            type='submit'
            disabled={isPending}
            className='order-1 text-foreground md:order-2'
            variant='destructive'
            onClick={handleRevoke}
            data-testid='revoke-session-button-confirm'
          >
            {isPending ? (
              <>
                <span>Revoking...</span>
                <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
              </>
            ) : (
              <span>Revoke</span>
            )}
          </Button>
          <ResponsiveDialogClose asChild className='order-2 md:order-1'>
            <Button variant='outline' type='button'>
              Cancel
            </Button>
          </ResponsiveDialogClose>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
