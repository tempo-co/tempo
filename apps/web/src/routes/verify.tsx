import {createFileRoute, redirect} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {AnimatePresence, motion} from 'framer-motion';
import {useState} from 'react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
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

  const {logOut, isPending} = useLogOut();
  const {currentUser} = useCurrentUser({skipFetch: true});
  const [showForm, setShowForm] = useState(false);

  const handleLogout = async () => {
    await logOut();
  };

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
                    <VerifyForm code={code} />
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
                    >
                      Enter code manually
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
                disabled={isPending}
              >
                {isPending ? 'Logging out...' : 'Log out'}
              </Button>
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </AuthLayout>
  );
}
