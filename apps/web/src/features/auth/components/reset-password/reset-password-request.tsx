import {zodResolver} from '@hookform/resolvers/zod';
import {Link} from '@tanstack/react-router';
import {AnimatePresence, motion} from 'framer-motion';
import {ExternalLink} from 'lucide-react';
import {useState} from 'react';
import {useForm} from 'react-hook-form';

import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {cn} from '@/utils/cn';

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
    try {
      await requestPasswordReset(form.getValues());
      setHasResent(true);
    } catch {
      // The mutation surfaces its own network and server feedback.
    }
  };

  const handleTryAgain = () => {
    reset();
    form.reset();
    setHasResent(false);
  };

  const gmailUrl = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent('from:no-reply@localhost')}`;

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
              role='status'
              aria-live='polite'
              className='flex w-full flex-col gap-4 text-sm'
            >
              <div className='space-y-2'>
                <p className='leading-6 text-muted-foreground'>
                  {hasResent ? (
                    <>
                      We sent a new reset link to{' '}
                      <span className='break-words font-medium text-foreground'>
                        {form.getValues('email')}
                      </span>
                      .
                    </>
                  ) : (
                    <>
                      If{' '}
                      <span className='break-words font-medium text-foreground'>
                        {form.getValues('email')}
                      </span>{' '}
                      matches an account, we&apos;ve sent a link to reset your password.
                    </>
                  )}
                </p>
                <p className='text-xs leading-5 text-muted-foreground'>
                  It can take a few minutes. Check your spam folder if it doesn&apos;t arrive.
                </p>
              </div>
              <div className='flex flex-col gap-2'>
                {!hasResent && (
                  <Button
                    variant='outline'
                    onClick={handleResend}
                    className='w-full'
                    data-testid='resend-button'
                  >
                    Resend email
                  </Button>
                )}
                <Button
                  variant='ghost'
                  onClick={handleTryAgain}
                  className='w-full text-foreground'
                  data-testid='use-different-email-button'
                >
                  Use a different email
                </Button>
              </div>
              <Button asChild className='w-full' data-testid='open-gmail-button'>
                <Link to={gmailUrl} target='_blank' rel='noopener noreferrer'>
                  Open Gmail <ExternalLink />
                </Link>
              </Button>
              <p className='text-center text-sm text-muted-foreground'>
                <Button variant='link' asChild className='h-auto p-0 text-foreground'>
                  <Link to='/login' data-testid='return-to-login-link'>
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
              className='flex w-full flex-col gap-4'
            >
              <p className='text-sm leading-6 text-muted-foreground'>
                Enter your account&apos;s email address, and we&apos;ll send you a link to reset
                your password.
              </p>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} noValidate className='grid gap-3'>
                  <FormField
                    control={form.control}
                    name='email'
                    render={({field, fieldState}) => (
                      <FormItem>
                        <FormLabel htmlFor='email'>Email</FormLabel>
                        <FormControl>
                          <Input
                            id='email'
                            placeholder='example@domain.com'
                            {...field}
                            value={field.value ?? ''}
                            type='email'
                            autoCapitalize='none'
                            autoComplete='email'
                            autoCorrect='off'
                            disabled={isPending}
                            className={cn(fieldState.error && 'border-destructive')}
                            data-testid='email-input'
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type='submit'
                    className='mt-1 w-full'
                    disabled={isPending}
                    data-testid='continue-button'
                  >
                    {isPending ? 'Sending link...' : 'Send reset link'}
                  </Button>
                </form>
              </Form>
              <p className='pt-0 text-center text-sm text-muted-foreground'>
                <Button variant='link' asChild className='h-auto p-0 text-foreground'>
                  <Link to='/login' data-testid='return-to-login-link'>
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
