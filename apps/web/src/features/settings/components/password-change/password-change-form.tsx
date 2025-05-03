import {zodResolver} from '@hookform/resolvers/zod';
import {Loader} from 'lucide-react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {DialogClose, DialogFooter} from '@/components/ui/dialog';
import {Form, FormField} from '@/components/ui/form';
import {PasswordInputField} from '@/components/ui/password-input-field';
import {useMediaQuery} from '@/hooks/use-media-query';
import {cn} from '@/utils/cn';

import {useChangePassword} from '../../api/use-change-password';
import {PasswordChangeDto, passwordChangeDtoSchema} from '../../types/password-change.dto';

type PasswordChangeFormProps = {
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export function PasswordChangeForm({setOpen}: PasswordChangeFormProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

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
        setOpen(false);
      },
    });
  }

  return (
    <div className={cn(!isDesktop && 'px-4')}>
      <Form {...form}>
        <form
          className={cn('grid items-start gap-4')}
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
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
          <div className='mt-4 flex w-full gap-4'>
            {isDesktop && (
              <DialogFooter className='w-full'>
                <DialogClose asChild>
                  <Button variant='outline' type='button'>
                    Cancel
                  </Button>
                </DialogClose>
              </DialogFooter>
            )}
            <Button type='submit' disabled={isPending}>
              {isPending ? (
                <>
                  <span>Changing password...</span>
                  <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
                </>
              ) : (
                <span>Change password</span>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
