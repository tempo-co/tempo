import {Trash2} from 'lucide-react';
import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

import {Session} from '../../types/session';
import {SessionCard} from './session-card';
import {SessionRevokeForm} from './session-revoke-form';

type SessionRevokeDialogProps = {
  session: Session;
};

export function SessionRevokeDialog({session}: SessionRevokeDialogProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [isOpen, setIsOpen] = useState(false);
  if (isDesktop) {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button variant='outline' className='w-full text-foreground sm:w-fit' size='sm'>
            <Trash2 />
            Revoke
          </Button>
        </DialogTrigger>
        <DialogContent aria-describedby='Revoke session' className='max-w-[33rem]'>
          <DialogHeader>
            <DialogTitle>Revoke session</DialogTitle>
            <DialogDescription className='pt-2'>
              Are you sure you want to revoke this session?
            </DialogDescription>
          </DialogHeader>
          <SessionCard session={session} hideRevokeButton forceStackedLayout />
          <SessionRevokeForm session={session} setIsOpen={setIsOpen} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={isOpen} onOpenChange={setIsOpen}>
      <DrawerTrigger asChild>
        <Button variant='outline' className='w-full text-foreground sm:w-fit' size='sm'>
          <Trash2 />
          Revoke
        </Button>
      </DrawerTrigger>
      <DrawerContent aria-describedby='Revoke session'>
        <DrawerHeader className='text-left'>
          <DrawerTitle>Revoke session</DrawerTitle>
          <DrawerDescription className='pt-2'>
            Are you sure you want to revoke this session?
          </DrawerDescription>
        </DrawerHeader>
        <div className='px-4'>
          <SessionCard session={session} hideRevokeButton forceStackedLayout />
          <SessionRevokeForm session={session} setIsOpen={setIsOpen} />
        </div>
        <DrawerFooter className='pt-4'>
          <DrawerClose asChild>
            <Button variant='outline'>Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
