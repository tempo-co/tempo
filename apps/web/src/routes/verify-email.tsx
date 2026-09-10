import {Link, createFileRoute, redirect, useRouter} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {AnimatePresence, motion} from 'framer-motion';
import {Loader} from 'lucide-react';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {useVerifyEmail} from '@/features/auth/api/use-verify-email';
import {AuthLayout} from '@/features/auth/components/auth-layout';
import {ResendCodeButton} from '@/features/auth/components/resend-code-button';
import {VerifyEmailForm} from '@/features/auth/components/verify-email/verify-email-form';
import {switchContentVariants} from '@/features/auth/constants/animations';
import {searchParamsSchema} from '@/features/auth/types/email-verify.dto';
import {useCurrentAccount} from '@/hooks/use-current-account';
import {useLogOut} from '@/hooks/use-logout';

export const Route = createFileRoute('/verify-email')({
  component: VerifyEmailIndex,
  validateSearch: zodValidator(searchParamsSchema),
  beforeLoad: ({context, search}) => {
    const hasValidParams = !!(search.code && search.email);

    if (context.isAuthenticated && context.isEmailVerified) {
      toast.info('Your email has already been verified.', {id: 'email-already-verified'});
      throw redirect({to: '/'});
    }

    if (!context.isAuthenticated) {
      if (!hasValidParams) {
        toast.error('Invalid verification link', {
          description: 'Please log in to request a new link.',
          id: 'invalid-verification-link',
        });
        throw redirect({to: '/login'});
      }
      return;
    }
  },
});

function VerifyEmailIndex() {
  const router = useRouter();
  const searchParams = Route.useSearch();
  const code = searchParams.code ? String(searchParams.code) : undefined;
  const email = searchParams.email;

  const {logOut, isPending: isLoggingOut} = useLogOut();
  const {currentAccount, isAuthenticated} = useCurrentAccount({skipFetch: true});
  const [showForm, setShowForm] = useState(false);
  const {verifyEmail, isPending, error, reset} = useVerifyEmail();

  const hasValidParams = !!(code && email);
  useEffect(() => {
    if (hasValidParams) {
      void verifyEmail({code, email});
    }
  }, [code, email, verifyEmail, hasValidParams]);

  const handleLogout = async () => {
    await logOut();
  };

  const handleRetryVerification = () => {
    if (!code || !email) return;

    reset();
    void verifyEmail({code, email});
  };

  if (error && error.status === 400) {
    return (
      <AuthLayout title={'Invalid or expired verification link'}>
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
              className='flex w-full flex-col gap-4 text-center text-sm'
            >
              <p className='leading-6 text-muted-foreground'>
                We couldn&apos;t verify{' '}
                {email ? <span className='text-foreground'>{email}</span> : 'your email'} using this
                link.{!isAuthenticated && ' Please request a new link by logging in.'}
              </p>
              <div className='text-foreground'>
                {isAuthenticated ? (
                  <ResendCodeButton
                    variant='outline'
                    className='w-full'
                    onSuccess={() => {
                      void router.navigate({to: '/verify-email', search: {}});
                      reset();
                    }}
                  />
                ) : (
                  <Button asChild className='w-full'>
                    <Link to='/login' data-testid='log-in-button'>
                      Log in
                    </Link>
                  </Button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </AuthLayout>
    );
  }

  if (error && error.status === 429) {
    return (
      <AuthLayout title={'Rate limit exceeded'}>
        <div className='relative flex flex-col'>
          <AnimatePresence initial={false} mode='wait'>
            <motion.div
              key='error-view-fade'
              variants={switchContentVariants}
              initial='hidden'
              animate='visible'
              exit='exit'
              role='status'
              aria-live='polite'
              className='flex w-full flex-col gap-4 text-center text-sm text-muted-foreground'
            >
              <p>You&apos;re trying to verify your email too often.</p>
              <p>Please try again later.</p>
              <div className='text-foreground'>
                <Button variant='link' asChild>
                  <Link to='/'>Go home</Link>
                </Button>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </AuthLayout>
    );
  }

  if (error) {
    return (
      <AuthLayout title='Verification failed'>
        <div className='relative flex flex-col'>
          <AnimatePresence initial={false} mode='wait'>
            <motion.div
              key='unknown-error-view-fade'
              variants={switchContentVariants}
              initial='hidden'
              animate='visible'
              exit='exit'
              role='alert'
              aria-live='assertive'
              className='flex w-full flex-col gap-4 text-center text-sm'
            >
              <p className='leading-6 text-muted-foreground'>
                We couldn&apos;t verify your email right now. Please try again.
              </p>
              <Button
                type='button'
                className='w-full'
                onClick={handleRetryVerification}
                disabled={isPending}
                data-testid='retry-verification-button'
              >
                Try again
              </Button>
              <p className='text-muted-foreground'>
                {isAuthenticated ? (
                  <Link
                    to='/verify-email'
                    className='text-foreground underline-offset-4 hover:underline'
                  >
                    Return to verification
                  </Link>
                ) : (
                  <Link to='/login' className='text-foreground underline-offset-4 hover:underline'>
                    Log in instead
                  </Link>
                )}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
      </AuthLayout>
    );
  }

  if (hasValidParams || isPending) {
    return (
      <AuthLayout title={'Verifying your email...'} disabledLogoLink>
        <div className='relative flex flex-col'>
          <AnimatePresence initial={false} mode='wait'>
            <motion.div
              key='loading-view-fade'
              variants={switchContentVariants}
              initial='hidden'
              animate='visible'
              exit='exit'
              role='status'
              aria-live='polite'
              className='flex w-full flex-col items-center gap-4 text-sm text-muted-foreground'
            >
              <Loader aria-hidden className='h-10 w-10 animate-slow-spin text-primary' />
            </motion.div>
          </AnimatePresence>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={showForm ? 'Enter your verification code' : 'Check your email'}>
      <div className='relative flex flex-col'>
        <AnimatePresence mode='wait' initial={false}>
          <motion.div
            key='verify-content'
            variants={switchContentVariants}
            initial='hidden'
            animate='visible'
            exit='exit'
            layout
            className='flex w-full flex-col items-center gap-4'
          >
            <div className='w-full text-center text-sm text-muted-foreground'>
              <p>We sent a verification email to</p>
              <p className='mt-1 break-words font-medium text-foreground'>
                {currentAccount?.email ?? 'your email address'}
              </p>
              <p className='mt-3 text-xs leading-5'>
                Click the link in the email, or enter the 6-digit code manually.
              </p>
            </div>
            <div className='w-full'>
              <AnimatePresence mode='wait' initial={false}>
                <motion.div
                  key='verify-button'
                  variants={switchContentVariants}
                  initial='hidden'
                  animate='visible'
                  exit='exit'
                  className='flex w-full flex-col gap-2'
                >
                  {showForm ? (
                    <VerifyEmailForm />
                  ) : (
                    <Button
                      data-testid='enter-code-manually-button'
                      variant='secondary'
                      className='w-full'
                      onClick={() => setShowForm(true)}
                    >
                      Enter code manually
                    </Button>
                  )}
                  <ResendCodeButton variant='outline' />
                </motion.div>
              </AnimatePresence>
            </div>
            <p className='pt-0 text-center text-sm text-muted-foreground'>
              Need to start over?{' '}
              <Button
                variant='link'
                className='h-auto p-0 text-foreground underline-offset-4 hover:underline'
                onClick={handleLogout}
                disabled={isLoggingOut}
              >
                {isLoggingOut ? 'Logging out...' : 'Log out'}
              </Button>
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </AuthLayout>
  );
}
