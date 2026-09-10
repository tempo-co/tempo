import {zodResolver} from '@hookform/resolvers/zod';
import {Link} from '@tanstack/react-router';
import {AnimatePresence, motion} from 'framer-motion';
import {Loader} from 'lucide-react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {Form, FormField} from '@/components/ui/form';
import {PasswordInputField} from '@/components/ui/password-input-field';
import {Account} from '@/types/account';
import {HttpError} from '@/utils/api';

import {usePasswordResetVerify} from '../../api/use-password-reset-verify';
import {switchContentVariants} from '../../constants/animations';
import {
  PasswordResetVerifyDto,
  passwordResetVerifyDtoSchema,
} from '../../types/password-reset-verify.dto';
import {AuthLayout} from '../auth-layout';

type ResetPasswordVerifyProps = {
  token: string;
  email: Account['email'];
};

export function ResetPasswordVerify({token, email}: ResetPasswordVerifyProps) {
  const form = useForm<PasswordResetVerifyDto>({
    resolver: zodResolver(passwordResetVerifyDtoSchema),
    mode: 'onSubmit',
    defaultValues: {token},
  });

  const {verifyPasswordReset, isPending, isSuccess, error} = usePasswordResetVerify();
  const isInvalidToken =
    error?.status === 400 && error.message.includes('Invalid or expired password reset token');

  async function onSubmit(formData: PasswordResetVerifyDto) {
    form.clearErrors('newPassword');

    try {
      await verifyPasswordReset(formData);
    } catch (submitError) {
      if (submitError instanceof HttpError && submitError.status === 400) {
        form.setError('newPassword', {
          type: 'server',
          message: submitError.message.includes('same as the current password')
            ? 'Choose a different password from your current one.'
            : "We couldn't reset your password. Please try again.",
        });
      }
    }
  }

  if (isSuccess) {
    return (
      <AuthLayout title='Password reset successful'>
        <div className='relative flex flex-col'>
          <AnimatePresence initial={false} mode='wait'>
            <motion.div
              key='success-view-fade'
              variants={switchContentVariants}
              initial='hidden'
              animate='visible'
              exit='exit'
              role='status'
              aria-live='polite'
              className='flex w-full flex-col gap-4 text-sm'
            >
              <p className='leading-6 text-muted-foreground'>
                Your new password is ready. You can now log in to your Tempo account.
              </p>
              <Button asChild className='w-full'>
                <Link to='/login' data-testid='return-to-login-link'>
                  Go to log in
                </Link>
              </Button>
            </motion.div>
          </AnimatePresence>
        </div>
      </AuthLayout>
    );
  }

  if (isInvalidToken) {
    return (
      <AuthLayout title='Invalid or expired token'>
        <div className='relative flex flex-col'>
          <AnimatePresence initial={false} mode='wait'>
            <motion.div
              key='error-view-fade'
              variants={switchContentVariants}
              initial='hidden'
              animate='visible'
              exit='exit'
              role='alert'
              aria-live='assertive'
              className='flex w-full flex-col gap-4 text-sm'
            >
              <p className='leading-6 text-muted-foreground'>
                This reset link is no longer valid. Request a new link to choose another password.
              </p>
              <Button asChild className='w-full'>
                <Link to='/reset-password' data-testid='request-new-link'>
                  Request a new link
                </Link>
              </Button>
              <p className='text-center text-sm text-muted-foreground'>
                <Link
                  to='/login'
                  className='text-foreground underline-offset-4 hover:underline'
                  data-testid='return-to-login-link'
                >
                  Log in
                </Link>
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title='Choose a new password'>
      <div className='relative flex flex-col'>
        <AnimatePresence initial={false} mode='wait'>
          <motion.div
            key='verify-form-view-fade'
            variants={switchContentVariants}
            initial='hidden'
            animate='visible'
            exit='exit'
            className='flex w-full flex-col gap-4'
          >
            <p className='text-sm leading-6 text-muted-foreground'>
              Choose a new password for the account associated with{' '}
              <span className='break-words font-medium text-foreground'>{email}</span>.
            </p>
            <Form {...form}>
              <form
                className='grid items-start gap-3'
                onSubmit={form.handleSubmit(onSubmit)}
                noValidate
              >
                <FormField
                  control={form.control}
                  name='newPassword'
                  render={({field, fieldState}) => (
                    <PasswordInputField<PasswordResetVerifyDto, 'newPassword'>
                      field={field}
                      fieldState={fieldState}
                      label='New password'
                      id='new-password'
                      autoComplete='new-password'
                      description='Use at least 8 characters.'
                      disabled={isPending}
                    />
                  )}
                />
                <Button
                  type='submit'
                  disabled={isPending}
                  className='mt-1 w-full'
                  data-testid='reset-button'
                >
                  {isPending ? (
                    <>
                      <span>Resetting password...</span>
                      <Loader className='h-4 w-4 animate-slow-spin' />
                    </>
                  ) : (
                    <span>Reset password</span>
                  )}
                </Button>
              </form>
            </Form>
            <p className='pt-0 text-center text-sm text-muted-foreground'>
              <Link
                to='/login'
                className='text-foreground underline-offset-4 hover:underline'
                data-testid='return-to-login-link'
              >
                Return to log in
              </Link>
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </AuthLayout>
  );
}
