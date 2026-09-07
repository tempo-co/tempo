import {zodResolver} from '@hookform/resolvers/zod';
import {useNavigate} from '@tanstack/react-router';
import {Loader} from 'lucide-react';
import {isValidElement, useState} from 'react';
import {useForm} from 'react-hook-form';
import {z} from 'zod';

import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
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
import {useCurrentAccount} from '@/hooks/use-current-account';

import {useDeleteAccount} from '../../api/use-delete-account';
import {AccountDeleteDto, accountDeleteDtoSchema} from '../../types/account-delete.dto';

const accountDeleteFormSchema = accountDeleteDtoSchema.extend({
  email: z.string().min(1, 'Please type your email to confirm.'),
});

type AccountDeleteFormValues = z.infer<typeof accountDeleteFormSchema>;

type AccountDeleteDialogProps = {
  children: React.ReactNode;
};

export function AccountDeleteDialog({children}: AccountDeleteDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const {currentAccount} = useCurrentAccount({skipFetch: true});
  const {deleteAccount, isPending} = useDeleteAccount();

  const form = useForm<AccountDeleteFormValues>({
    resolver: zodResolver(accountDeleteFormSchema),
    mode: 'onSubmit',
    defaultValues: {email: '', password: ''},
  });

  const confirmEmail = currentAccount?.email ?? '';
  const emailValue = form.watch('email');
  const passwordValue = form.watch('password');
  const emailMatches = confirmEmail !== '' && emailValue === confirmEmail;
  const canSubmit = emailMatches && passwordValue.length > 0 && !isPending;

  const onSubmit = async (formData: AccountDeleteFormValues) => {
    const dto: AccountDeleteDto = {password: formData.password};
    await deleteAccount(dto, {
      onError: (error) => {
        if (error.status === 401) {
          form.setError('password', {message: 'Invalid password.'}, {shouldFocus: true});
        }
      },
      onSuccess: async () => {
        setIsOpen(false);
        await navigate({to: '/'});
      },
    });
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={setIsOpen}>
      <ResponsiveDialogTrigger asChild>
        {isValidElement(children) ? children : null}
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className='md:w-[26rem]'>
        <ResponsiveDialogHeader className='text-start'>
          <ResponsiveDialogTitle>Delete account</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='pt-2'>
            This permanently deletes your account and all data, including connected banks and
            transactions. This cannot be undone.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <p className='mb-4 text-sm text-muted-foreground'>
            Type <span className='text-foreground'>{confirmEmail}</span> to confirm.
          </p>
          <Form {...form}>
            <form
              className='grid items-start gap-4'
              onSubmit={form.handleSubmit(onSubmit)}
              noValidate
            >
              <FormField
                control={form.control}
                name='email'
                render={({field}) => (
                  <FormItem>
                    <FormLabel>Email confirmation</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        id='delete-account-email'
                        data-testid='delete-account-email-input'
                        autoComplete='off'
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='password'
                render={({field, fieldState}) => (
                  <PasswordInputField<AccountDeleteFormValues, 'password'>
                    field={field}
                    fieldState={fieldState}
                    label='Password'
                    id='delete-account-password'
                    autoComplete='current-password'
                    disabled={isPending}
                  />
                )}
              />
              <div className='mt-2 flex flex-col justify-end gap-4 md:flex-row'>
                <Button
                  type='submit'
                  variant='destructive'
                  disabled={!canSubmit}
                  className='order-1 text-foreground md:order-2'
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
