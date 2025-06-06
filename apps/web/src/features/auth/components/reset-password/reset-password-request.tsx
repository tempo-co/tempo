import {zodResolver} from '@hookform/resolvers/zod';
import {Link} from '@tanstack/react-router';
import {AnimatePresence, motion} from 'framer-motion';
import {ExternalLink} from 'lucide-react';
import {useState} from 'react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';

import {usePasswordResetRequest} from '../../api/use-password-reset-request';
import {switchContentVariants} from '../../constants/animations';
import {
  PasswordResetRequestDto,
  passwordResetRequestDtoSchema,
} from '../../types/password-reset-request.dto';
import {AuthLayout} from '../auth-layout';

export function ResetPasswordRequest() {
  const {requestPasswordReset, isPending, isSuccess, reset} = usePasswordResetRequest();
  const [hasResent, setHasResent] = useState(false);

  const form = useForm<PasswordResetRequestDto>({
    resolver: zodResolver(passwordResetRequestDtoSchema),
  });

  const onSubmit = async (formData: PasswordResetRequestDto) => {
    await requestPasswordReset(formData);
  };

  const handleResend = async () => {
    setHasResent(true);
    await requestPasswordReset(form.getValues());
  };

  const handleTryAgain = () => {
    reset();
    form.reset();
    setHasResent(false);
  };

  const gmailUrl = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent('from:no-reply@flair.com')}`;

  return (
    <AuthLayout title={isSuccess ? 'Check your email' : 'Reset your password'}>
      <div className='relative flex flex-col'>
        <AnimatePresence initial={false} mode='wait'>
          {isSuccess ? (
            <motion.div
              key='success-view-fade'
              variants={switchContentVariants}
              initial='hidden'
              animate='visible'
              exit='exit'
              className='flex w-full flex-col space-y-4 text-sm text-muted-foreground'
            >
              {hasResent ? (
                <p>
                  We&apos;ve resent an email to{' '}
                  <span className='text-foreground'>{form.getValues('email')}</span> with
                  instructions to reset your password.
                </p>
              ) : (
                <p>
                  If <span className='text-foreground'>{form.getValues('email')}</span> matches an
                  email in our system, then we&apos;ve sent you an email with further instructions
                  to reset your password.
                </p>
              )}
              <p>
                If you don&apos;t see the email within 5 minutes, check your spam folder
                {!hasResent && (
                  <>
                    ,{' '}
                    <Button
                      variant='link'
                      onClick={handleResend}
                      className='h-auto p-0 text-foreground'
                      data-testid='resend-button'
                    >
                      resend
                    </Button>
                  </>
                )}
                , or{' '}
                <Button
                  variant='link'
                  onClick={handleTryAgain}
                  className='h-auto p-0 text-foreground'
                  data-testid='use-different-email-button'
                >
                  use a different email
                </Button>
                .
              </p>
              <div className='flex justify-center'>
                <Button
                  asChild
                  className='mt-4 flex h-auto items-center gap-2'
                  data-testid='open-gmail-button'
                >
                  <Link to={gmailUrl} target='_blank' rel='noopener noreferrer'>
                    Open Gmail <ExternalLink size={16} />
                  </Link>
                </Button>
              </div>
              <p className='px-8 pt-4 text-center text-sm text-muted-foreground'>
                <Button variant='link' asChild>
                  <Link to='/login' className='text-foreground' data-testid='return-to-login-link'>
                    Log in
                  </Link>
                </Button>
              </p>
            </motion.div>
          ) : (
            <motion.div
              key='reset-form-view-fade'
              variants={switchContentVariants}
              initial='hidden'
              animate='visible'
              exit='exit'
              className='flex w-full flex-col space-y-4'
            >
              <p className='text-sm text-muted-foreground'>
                Enter your account&apos;s email address, and we&apos;ll send you a link to reset
                your password.
              </p>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className='grid gap-4'>
                  <FormField
                    control={form.control}
                    name='email'
                    render={({field}) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            placeholder='example@domain.com'
                            {...field}
                            type='email'
                            autoCapitalize='none'
                            autoComplete='email'
                            autoCorrect='off'
                            disabled={isPending}
                            data-testid='email-input'
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type='submit'
                    className='mt-2 w-full'
                    disabled={isPending}
                    data-testid='continue-button'
                  >
                    {isPending ? 'Continuing...' : 'Continue'}
                  </Button>
                </form>
              </Form>
              <p className='px-8 pt-4 text-center text-sm text-muted-foreground'>
                <Button variant='link' asChild>
                  <Link to='/login' className='text-foreground' data-testid='return-to-login-link'>
                    Log in
                  </Link>
                </Button>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AuthLayout>
  );
}
