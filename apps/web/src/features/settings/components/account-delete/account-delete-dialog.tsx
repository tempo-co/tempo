import {zodResolver} from '@hookform/resolvers/zod';
import {Loader} from 'lucide-react';
import {isValidElement, useState} from 'react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {Form, FormField} from '@/components/ui/form';
import {PasswordInputField} from '@/components/ui/password-input-field';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';

import {useDeleteAccount} from '../../api/use-delete-account';
import {AccountDeleteDto, accountDeleteDtoSchema} from '../../types/account-delete.dto';

type AccountDeleteDialogProps = {
  children: React.ReactNode;
};

export function AccountDeleteDialog({children}: AccountDeleteDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const {deleteAccount, isPending} = useDeleteAccount();

  const form = useForm<AccountDeleteDto>({
    resolver: zodResolver(accountDeleteDtoSchema),
    mode: 'onSubmit',
    defaultValues: {password: ''},
  });

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    // Don't keep a typed password or a stale error around in a closed dialog.
    if (!open) form.reset();
  };

  const onSubmit = async (dto: AccountDeleteDto) => {
    await deleteAccount(dto, {
      onError: (error) => {
        if (error.status === 401) {
          form.setError('password', {message: 'Invalid password.'}, {shouldFocus: true});
        }
      },
      onSuccess: () => setIsOpen(false),
    });
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={handleOpenChange}>
      <ResponsiveDialogTrigger asChild>
        {isValidElement(children) ? children : null}
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className='md:w-104'>
        <ResponsiveDialogHeader className='text-start'>
          <ResponsiveDialogTitle>Delete account</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='pt-2'>
            This permanently deletes your Tempo account and all of its bank connections, bank
            accounts and transaction history. This can&apos;t be undone.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <Form {...form}>
            <form
              className='grid items-start gap-4'
              onSubmit={form.handleSubmit(onSubmit)}
              noValidate
            >
              <FormField
                control={form.control}
                name='password'
                render={({field, fieldState}) => (
                  <PasswordInputField<AccountDeleteDto, 'password'>
                    field={field}
                    fieldState={fieldState}
                    label='Enter your password to confirm'
                    id='delete-account-password'
                    autoComplete='current-password'
                    disabled={isPending}
                  />
                )}
              />
              <div className='mt-2 flex flex-col justify-end gap-4 pb-4 md:flex-row md:pb-0'>
                <Button
                  type='submit'
                  variant='destructive'
                  disabled={isPending}
                  className='order-1 md:order-2'
                  data-testid='delete-account-confirm'
                >
                  {isPending ? (
                    <>
                      <span>Deleting account...</span>
                      <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
                    </>
                  ) : (
                    'Delete account'
                  )}
                </Button>
                <ResponsiveDialogClose asChild className='order-2 md:order-1'>
                  <Button variant='outline' type='button'>
                    Cancel
                  </Button>
                </ResponsiveDialogClose>
              </div>
            </form>
          </Form>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
