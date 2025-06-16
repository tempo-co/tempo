import {Loader} from 'lucide-react';
import {useState} from 'react';

import {Button} from '@/components/ui/button';
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

import {useRevokeAllSessions} from '../../api/use-revoke-all-sessions';

export function SessionRevokeAllDialog() {
  const [isOpen, setIsOpen] = useState(false);

  const {revokeAllSessions, isPending} = useRevokeAllSessions();

  const handleRevoke = async () => {
    await revokeAllSessions();
    setIsOpen(false);
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={setIsOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button
          variant='ghost'
          className='w-fit text-foreground sm:w-fit'
          size='sm'
          data-testid='revoke-all-sessions-button'
        >
          Revoke all
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className='md:max-w-[30rem]'>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Revoke access</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='pt-2'>
            Revoke all other sessions? This cannot be undone.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter className='flex gap-4'>
          <Button
            type='submit'
            disabled={isPending}
            className='order-1 text-foreground md:order-2'
            variant='destructive'
            onClick={handleRevoke}
            data-testid='revoke-all-sessions-button-confirm'
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
