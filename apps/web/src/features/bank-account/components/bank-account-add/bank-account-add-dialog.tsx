import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';

import {BankAccountAddForm} from './bank-account-add-form';

export function BankAccountAddDialog() {
  const [isOpen, setIsOpen] = useState(false);

  const title = 'Add bank account';

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={setIsOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button>{title}</Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className='md:max-w-96'>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <BankAccountAddForm setIsOpen={setIsOpen} />
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
