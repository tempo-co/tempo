import {createFileRoute, redirect} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {AnimatePresence, motion} from 'framer-motion';
import {Loader2} from 'lucide-react';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {useVerifyEmail} from '@/features/auth/api/use-verify-email';
import {AuthLayout} from '@/features/auth/components/auth-layout';
import {VerifyForm} from '@/features/auth/components/verify-form';
import {switchContentVariants} from '@/features/auth/constants/animations';
import {searchParamsSchema} from '@/features/auth/types/email-verify.dto';
import {useCurrentUser} from '@/hooks/use-current-user';
import {useLogOut} from '@/hooks/use-logout';

export const Route = createFileRoute('/verify')({
  component: VerifyIndex,
  validateSearch: zodValidator(searchParamsSchema),
  beforeLoad: ({context}) => {
    if (context.isAuthenticated && context.isEmailVerified) {
      toast.info('Your email has already been verified.');
      throw redirect({to: '/home'});
    }
  },
});

function VerifyIndex() {
  const searchParams = Route.useSearch();
  const code = searchParams.code ? String(searchParams.code) : undefined;
  const email = searchParams.email;

  const {logOut, isPending: isLoggingOut} = useLogOut();
  const {currentUser} = useCurrentUser({skipFetch: true});
  const [showForm, setShowForm] = useState(false);
  const {verifyEmail, isPending: isVerifying} = useVerifyEmail();

  useEffect(() => {
    if (currentUser && code && email) {
      void verifyEmail({code});
    }
  }, [code, currentUser, email, verifyEmail]);

  const handleLogout = async () => {
    await logOut();
  };

  if (isVerifying)
    return (
      <div className='flex h-screen w-screen items-center justify-center bg-background'>
        <div className='flex flex-col items-center space-y-4 text-center'>
          <Loader2 className='h-14 w-14 animate-spin text-primary' />

          <p className='text-xl font-medium text-foreground'>Verifying your email...</p>
        </div>
      </div>
    );

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
                Please check your inbox
                {currentUser?.email ? (
                  <>
                    {' at '}
                    <span className='font-medium text-foreground'>{currentUser.email}</span>
                  </>
                ) : email ? (
                  <>
                    {' at '}
                    <span className='font-medium text-foreground'>{email}</span>
                  </>
                ) : (
                  '.'
                )}
              </p>
            </div>

            <div className='w-full px-4'>
              <AnimatePresence mode='wait' initial={false}>
                {showForm ? (
                  <motion.div
                    key='verify-form'
                    variants={switchContentVariants}
                    initial='hidden'
                    animate='visible'
                    exit='exit'
                    className='w-full'
                  >
                    <VerifyForm />
                  </motion.div>
                ) : (
                  <motion.div
                    key='verify-button'
                    variants={switchContentVariants}
                    initial='hidden'
                    animate='visible'
                    exit='exit'
                    className='w-full'
                  >
                    <Button
                      variant='secondary'
                      className='mt-4 w-full'
                      onClick={() => setShowForm(true)}
                      disabled={isVerifying}
                    >
                      {isVerifying ? 'Verifying...' : 'Enter code manually'}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <p className='px-8 pt-4 text-center text-sm text-muted-foreground'>
              Need to start over?{' '}
              <Button
                variant='link'
                className='h-auto p-0 text-foreground underline-offset-4 hover:underline'
                onClick={handleLogout}
                disabled={isLoggingOut || isVerifying}
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
