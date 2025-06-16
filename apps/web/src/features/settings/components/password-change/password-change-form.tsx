import {zodResolver} from '@hookform/resolvers/zod';
import {Loader} from 'lucide-react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {Form, FormField} from '@/components/ui/form';
import {PasswordInputField} from '@/components/ui/password-input-field';
import {ResponsiveDialogClose} from '@/components/ui/responsive-dialog';

import {useChangePassword} from '../../api/use-change-password';
import {PasswordChangeDto, passwordChangeDtoSchema} from '../../types/password-change.dto';

type PasswordChangeFormProps = {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export function PasswordChangeForm({setIsOpen}: PasswordChangeFormProps) {
  const form = useForm<PasswordChangeDto>({
    resolver: zodResolver(passwordChangeDtoSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const {changePassword, isPending} = useChangePassword();

  async function onSubmit(formData: PasswordChangeDto) {
    await changePassword(formData, {
      onError: (error) => {
        if (error.status === 401) {
          form.setError(
            'currentPassword',
            {message: 'Invalid current password.'},
            {shouldFocus: true},
          );
        }
      },
      onSuccess: () => {
        setIsOpen(false);
      },
    });
  }

  return (
    <Form {...form}>
      <form className='grid items-start gap-4' onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FormField
          control={form.control}
          name='currentPassword'
          render={({field, fieldState}) => (
            <PasswordInputField<PasswordChangeDto, 'currentPassword'>
              field={field}
              fieldState={fieldState}
              label='Current Password'
              id='current-password'
              autoComplete='current-password'
              disabled={isPending}
            />
          )}
        />
        <FormField
          control={form.control}
          name='newPassword'
          render={({field, fieldState}) => (
            <PasswordInputField<PasswordChangeDto, 'newPassword'>
              field={field}
              fieldState={fieldState}
              label='New password'
              id='new-password'
              autoComplete='new-password'
              disabled={isPending}
            />
          )}
        />
        <p className='text-xs text-muted-foreground'>
          Your password should be at least 8 characters long.
        </p>
        <div className='mb-4 mt-4 flex flex-col justify-end gap-4 md:mb-0 md:flex-row'>
          <Button
            type='submit'
            disabled={isPending}
            className='order-1 md:order-2'
            data-testid='change-password-confirm'
          >
            {isPending ? (
              <>
                <span>Changing password...</span>
                <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
              </>
            ) : (
              'Change password'
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
  );
}
