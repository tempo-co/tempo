import {Loader} from 'lucide-react';

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
import {useLogOut} from '@/hooks/use-logout';

type LogOutDialogProps = {
  triggerVariant?: ButtonProps['variant'];
};

export function LogOutDialog({triggerVariant = 'ghost'}: LogOutDialogProps) {
  const {logOut, isPending} = useLogOut();

  const handleLogOut = async () => {
    await logOut();
  };

  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>
        <Button
          variant={triggerVariant}
          className='w-full text-foreground sm:w-fit'
          size='sm'
          data-testid='log-out-button-session'
        >
          Log out
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className='md:max-w-[30rem]'>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Log out?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='pt-2'>
            You will be logged out from this session.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter className='flex gap-4'>
          <Button
            type='submit'
            disabled={isPending}
            onClick={handleLogOut}
            className='order-1 md:order-2'
            data-testid='log-out-button-session-confirm'
          >
            {isPending ? (
              <>
                <span>Logging out...</span>
                <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
              </>
            ) : (
              'Log out'
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
