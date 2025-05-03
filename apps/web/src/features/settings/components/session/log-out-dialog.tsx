import {Loader} from 'lucide-react';
import {useState} from 'react';

import {Button, ButtonProps} from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {useLogOut} from '@/hooks/use-logout';
import {useMediaQuery} from '@/hooks/use-media-query';

type LogOutDialogProps = {
  triggerVariant?: ButtonProps['variant'];
};

export function LogOutDialog({triggerVariant = 'ghost'}: LogOutDialogProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [isOpen, setIsOpen] = useState(false);

  const {logOut, isPending} = useLogOut();

  const handleLogOut = async () => {
    await logOut();
  };

  if (isDesktop) {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button variant={triggerVariant} className='w-full text-foreground sm:w-fit' size='sm'>
            Log out
          </Button>
        </DialogTrigger>
        <DialogContent aria-describedby='Log out' className='max-w-[33rem]'>
          <DialogHeader>
            <DialogTitle>Log out?</DialogTitle>
            <DialogDescription className='pt-2'>
              You will be logged out from this session.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className='flex gap-2'>
            <DialogClose asChild>
              <Button variant='outline' type='button'>
                Cancel
              </Button>
            </DialogClose>
            <Button type='submit' disabled={isPending} onClick={handleLogOut}>
              {isPending ? (
                <>
                  <span>Logging out...</span>
                  <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
                </>
              ) : (
                <span>Log out</span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={isOpen} onOpenChange={setIsOpen}>
      <DrawerTrigger asChild>
        <Button variant={triggerVariant} className='w-full text-foreground sm:w-fit' size='sm'>
          Log out
        </Button>
      </DrawerTrigger>
      <DrawerContent aria-describedby='Log out'>
        <DrawerHeader className='text-left'>
          <DrawerTitle>Log out?</DrawerTitle>
          <DrawerDescription className='pt-2'>
            You will be logged out from this session.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter className='pt-4'>
          <Button type='submit' disabled={isPending} className='w-full' onClick={handleLogOut}>
            {isPending ? (
              <>
                <span>Logging out...</span>
                <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
              </>
            ) : (
              <span>Log out</span>
            )}
          </Button>
          <DrawerClose asChild>
            <Button variant='outline'>Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
