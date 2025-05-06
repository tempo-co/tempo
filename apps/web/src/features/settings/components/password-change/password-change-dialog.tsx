import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {DialogTitle} from '@/components/ui/dialog';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';

import {PasswordChangeForm} from './password-change-form';

export function PasswordChangeDialog() {
  const [open, setOpen] = useState(false);

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button variant='ghost'>Change</Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className='md:w-[26rem]'>
        <ResponsiveDialogHeader className='text-start'>
          <DialogTitle className='mb-1'>Change password</DialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <PasswordChangeForm setOpen={setOpen} />
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
