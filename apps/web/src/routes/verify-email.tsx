import {Link, createFileRoute, redirect, useRouter} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {AnimatePresence, motion} from 'framer-motion';
import {Loader2} from 'lucide-react';
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
              className='flex w-full flex-col text-center'
            >
              <p className='text-sm text-muted-foreground'>
                We couldn&apos;t verify{' '}
                {email ? <span className='text-foreground'>{email}</span> : 'your email'} using this
                link.{!isAuthenticated && ' Please request a new link by logging in.'}
              </p>
              <div className='!mt-8 text-foreground'>
                {isAuthenticated ? (
                  <ResendCodeButton
                    variant='default'
                    className='w-fit'
                    onSuccess={() => {
                      void router.navigate({to: '/verify-email', search: {}});
                      reset();
                    }}
                  />
                ) : (
                  <Button asChild>
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
              className='flex w-full flex-col space-y-4 text-center text-sm text-muted-foreground'
            >
              <p>You&apos;re trying to verify your email too often.</p>
              <p className='!mt-0 mb-2'>Please try again later.</p>
              <div className='text-foreground'>
                <Button variant='link' asChild className='mt-4'>
                  <Link to='/'>Go home</Link>
                </Button>
              </div>
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
              className='flex w-full flex-col items-center space-y-4 text-sm text-muted-foreground'
            >
              <Loader2 className='h-12 w-12 animate-spin text-primary' />
            </motion.div>
          </AnimatePresence>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title='Check your email'>
      <div className='relative flex min-h-[180px] flex-col'>
        <AnimatePresence mode='wait' initial={false}>
          <motion.div
            key='verify-content'
            variants={switchContentVariants}
            initial='hidden'
            animate='visible'
            exit='exit'
            layout
            className='flex w-full flex-col items-center'
          >
            <div className='max-w-[21rem] text-center text-sm text-muted-foreground'>
              <p>We&apos;ve sent you a verification link.</p>
              <p className='mt-1 max-w-[21rem] px-4'>
                Please check your inbox at{' '}
                <span className='inline-block max-w-full truncate align-bottom font-medium text-foreground'>
                  {currentAccount?.email}
                </span>
              </p>
            </div>
            <div className='w-full px-4'>
              <AnimatePresence mode='wait' initial={false}>
                <motion.div
                  key='verify-button'
                  variants={switchContentVariants}
                  initial='hidden'
                  animate='visible'
                  exit='exit'
                  className='flex w-full flex-col gap-4'
                >
                  {showForm ? (
                    <VerifyEmailForm />
                  ) : (
                    <Button
                      data-testid='enter-code-manually-button'
                      variant='secondary'
                      className='mt-4 w-full'
                      onClick={() => setShowForm(true)}
                    >
                      Enter code manually
                    </Button>
                  )}
                  <ResendCodeButton />
                </motion.div>
              </AnimatePresence>
            </div>
            <p className='px-8 pt-4 text-center text-sm text-muted-foreground'>
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
