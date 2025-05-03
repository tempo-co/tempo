import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {useMediaQuery} from '@/hooks/use-media-query';

import {PasswordChangeForm} from './password-change-form';

export function PasswordChangeDialog() {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant='ghost'>Change</Button>
        </DialogTrigger>
        <DialogContent className='w-[26rem]' aria-describedby='Change password'>
          <DialogHeader>
            <DialogTitle className='mb-1'>Change password</DialogTitle>
          </DialogHeader>
          <PasswordChangeForm setOpen={setOpen} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant='ghost'>Change</Button>
      </DrawerTrigger>
      <DrawerContent aria-describedby='Change password'>
        <DrawerHeader className='text-left'>
          <DrawerTitle className='mb-1'>Change password</DrawerTitle>
        </DrawerHeader>
        <PasswordChangeForm setOpen={setOpen} />
        <DrawerFooter className='pt-4'>
          <DrawerClose asChild>
            <Button variant='outline'>Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
