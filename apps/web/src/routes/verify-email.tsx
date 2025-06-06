import {Link, createFileRoute, redirect} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {AnimatePresence, motion} from 'framer-motion';
import {Hourglass, Loader2, MailX} from 'lucide-react';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {useVerifyEmail} from '@/features/auth/api/use-verify-email';
import {useVerifyEmailChange} from '@/features/auth/api/use-verify-email-change';
import {AuthLayout} from '@/features/auth/components/auth-layout';
import {ResendCodeButton} from '@/features/auth/components/resend-code-button';
import {VerifyEmailForm} from '@/features/auth/components/verify-email/verify-email-form';
import {VerifyEmailStatusLayout} from '@/features/auth/components/verify-email/verify-email-status-layout';
import {switchContentVariants} from '@/features/auth/constants/animations';
import {searchParamsSchema} from '@/features/auth/types/email-verify.dto';
import {useCurrentAccount} from '@/hooks/use-current-account';
import {useLogOut} from '@/hooks/use-logout';

export const Route = createFileRoute('/verify-email')({
  component: VerifyEmailIndex,
  validateSearch: zodValidator(searchParamsSchema),
  beforeLoad: ({context, search}) => {
    const {code, email, flow} = search;
    if (!context.isAuthenticated) {
      if (!code || !email || !flow) {
        toast.error('Invalid verification link', {
          description: 'Please log in to request a new link.',
          id: 'invalid-verification-link',
        });
        throw redirect({to: '/login'});
      } else {
        if (search.flow === 'email-change') {
          toast.info('Please log in', {
            description: 'You must be authenticated to verify your new email.',
          });
          throw redirect({to: '/login'});
        }
      }
    } else {
      if ((!code || !email || !flow) && context.isEmailVerified) {
        toast.error('Invalid verification link', {
          description: 'The link you accessed is invalid or incomplete.',
          id: 'invalid-verification-link',
        });
        throw redirect({to: '/'});
      }
      if (search.flow === 'onboarding' && context.isEmailVerified) {
        toast.info('Your email has already been verified.');
        throw redirect({to: '/'});
      }
    }
  },
});

function VerifyEmailIndex() {
  const searchParams = Route.useSearch();
  const code = searchParams.code ? String(searchParams.code) : undefined;
  const email = searchParams.email;
  const flow = searchParams.flow;

  const {logOut, isPending: isLoggingOut} = useLogOut();
  const {currentAccount} = useCurrentAccount({skipFetch: true});
  const [showForm, setShowForm] = useState(false);
  const {verifyEmail, isPending: isVerifying, error: verifyError} = useVerifyEmail();

  const {verifyEmailChange, isPending: isVerifyingChange} = useVerifyEmailChange();

  useEffect(() => {
    if (!code || !email || !flow) return;

    if (flow === 'onboarding') {
      void verifyEmail({code, email});
    } else if (flow === 'email-change') {
      void verifyEmailChange({code, email});
    }
  }, [code, email, flow, verifyEmail, verifyEmailChange]);

  const handleLogout = async () => {
    await logOut();
  };

  if (isVerifying || isVerifyingChange) {
    return (
      <VerifyEmailStatusLayout
        icon={<Loader2 className='h-12 w-12 animate-spin text-primary' />}
        title='Verifying your email...'
      />
    );
  }

  if (verifyError) {
    if (verifyError.status === 429) {
      return (
        <VerifyEmailStatusLayout
          icon={<Hourglass className='h-12 w-12 text-destructive' />}
          title='Too many attempts'
          description="You're trying to verify your email too often. Please try again later."
          action={
            <Link
              to='/'
              className='text-sm text-foreground underline-offset-4 hover:underline'
              data-testid='go-home-link'
            >
              Go back home
            </Link>
          }
          maxWidth='max-w-[20rem]'
        />
      );
    } else {
      const emailContext = email ? <span className='text-foreground'>{email}</span> : 'your email';
      return (
        <VerifyEmailStatusLayout
          icon={<MailX className='h-12 w-12 text-destructive' />}
          title='Invalid or expired verification link.'
          description={
            <>
              We couldn&apos;t verify {emailContext} using this link. Please request a new
              verification email by logging in.
            </>
          }
          action={
            <Link
              to='/login'
              className='text-sm text-foreground underline-offset-4 hover:underline'
              data-test-id='return-to-login-link'
            >
              Log in
            </Link>
          }
          maxWidth='max-w-[28rem]'
        />
      );
    }
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
            className='flex w-full flex-col items-center space-y-4'
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
