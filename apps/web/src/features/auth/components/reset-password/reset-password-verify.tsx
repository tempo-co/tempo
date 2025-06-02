import {zodResolver} from '@hookform/resolvers/zod';
import {Link} from '@tanstack/react-router';
import {AnimatePresence, motion} from 'framer-motion';
import {Loader} from 'lucide-react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {Form, FormField} from '@/components/ui/form';
import {PasswordInputField} from '@/components/ui/password-input-field';
import {Account} from '@/types/account';
import {cn} from '@/utils/cn';

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
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {token},
  });

  const {verifyPasswordReset, isPending, isSuccess, error} = usePasswordResetVerify();

  async function onSubmit(formData: PasswordResetVerifyDto) {
    await verifyPasswordReset(formData);
  }

  if (isSuccess) {
    return (
      <AuthLayout title={'Password reset successful'}>
        <div className='relative flex flex-col'>
          <AnimatePresence initial={false} mode='wait'>
            <motion.div
              key='success-view-fade'
              variants={switchContentVariants}
              initial='hidden'
              animate='visible'
              exit='exit'
              className='flex w-full flex-col space-y-4 text-sm text-muted-foreground'
            >
              <p className='mb-2'>You can now use your new password to log in to your account.</p>
              <Button asChild>
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

  if (error?.status === 400) {
    return (
      <AuthLayout title={'Invalid or expired token'}>
        <div className='relative flex flex-col'>
          <AnimatePresence initial={false} mode='wait'>
            <motion.div
              key='success-view-fade'
              variants={switchContentVariants}
              initial='hidden'
              animate='visible'
              exit='exit'
              className='flex w-full flex-col space-y-4 text-sm text-muted-foreground'
            >
              <p className='mb-2'>
                Your password reset token is invalid or has expired. Please try requesting a new
                link.
              </p>
              <Button asChild>
                <Link to='/reset-password' data-testid='request-new-link'>
                  Request a new link
                </Link>
              </Button>
              <p className='px-8 pt-4 text-center text-sm text-muted-foreground'>
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
    <AuthLayout title={'Reset password'}>
      <div className='relative flex flex-col'>
        <AnimatePresence initial={false} mode='wait'>
          <motion.div
            key='verify-form-view-fade'
            variants={switchContentVariants}
            initial='hidden'
            animate='visible'
            exit='exit'
            className='flex w-full flex-col space-y-4'
          >
            <p className='text-sm text-muted-foreground'>
              Set a new password for the account associated with{' '}
              <span className='text-foreground'>{email}</span>.
            </p>
            <Form {...form}>
              <form
                className={cn('grid items-start gap-4')}
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
                      disabled={isPending}
                    />
                  )}
                />
                <Button
                  type='submit'
                  disabled={isPending}
                  className='mt-2'
                  data-testid='reset-button'
                >
                  {isPending ? (
                    <>
                      <span>Resetting password...</span>
                      <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
                    </>
                  ) : (
                    <span>Reset password</span>
                  )}
                </Button>
              </form>
            </Form>
            <p className='px-8 pt-4 text-center text-sm text-muted-foreground'>
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
