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
import {useMediaQuery} from '@/hooks/use-media-query';

import {useRevokeSession} from '../../api/use-revoke-session';
import {Session} from '../../types/session';

type SessionRevokeDialogProps = {
  session: Session;
  triggerVariant?: ButtonProps['variant'];
};

export function SessionRevokeDialog({session, triggerVariant = 'ghost'}: SessionRevokeDialogProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [isOpen, setIsOpen] = useState(false);

  const {revokeSession, isPending} = useRevokeSession();

  const handleRevoke = async () => {
    await revokeSession({id: session.id});
    setIsOpen(false);
  };

  if (isDesktop) {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button variant={triggerVariant} className='w-full text-foreground sm:w-fit' size='sm'>
            Revoke access
          </Button>
        </DialogTrigger>
        <DialogContent aria-describedby='Revoke access' className='max-w-[33rem]'>
          <DialogHeader>
            <DialogTitle>Revoke access</DialogTitle>
            <DialogDescription className='pt-2'>
              Revoke <span className='text-foreground'>{session.clientDescription}</span>? This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className='flex gap-2'>
            <DialogClose asChild>
              <Button variant='outline' type='button'>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type='submit'
              disabled={isPending}
              className='text-foreground'
              variant='destructive'
              onClick={handleRevoke}
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={isOpen} onOpenChange={setIsOpen}>
      <DrawerTrigger asChild>
        <Button variant={triggerVariant} className='w-full text-foreground sm:w-fit' size='sm'>
          Revoke
        </Button>
      </DrawerTrigger>
      <DrawerContent aria-describedby='Revoke access'>
        <DrawerHeader className='text-left'>
          <DrawerTitle>Revoke access</DrawerTitle>
          <DrawerDescription className='pt-2'>
            Revoke <span className='text-foreground'>{session.clientDescription}</span>? This cannot
            be undone.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter className='pt-4'>
          <Button
            type='submit'
            disabled={isPending}
            className='w-full text-foreground'
            variant='destructive'
            onClick={handleRevoke}
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
          <DrawerClose asChild>
            <Button variant='outline'>Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
