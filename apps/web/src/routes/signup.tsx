import {Link, createFileRoute} from '@tanstack/react-router';
import {AnimatePresence, motion} from 'framer-motion';

import {AuthLayout} from '@/features/auth/components/auth-layout';
import {SignUpForm} from '@/features/auth/components/signup-form';
import {switchContentVariants} from '@/features/auth/constants/animations';
import {handleUnauthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/signup')({
  component: SignUp,
  beforeLoad: ({context}) => {
    handleUnauthenticatedRedirect(context);
  },
});

function SignUp() {
  return (
    <AuthLayout title='Create your Flair account'>
      <div className='relative flex min-h-[220px] flex-col'>
        <AnimatePresence mode='wait' initial={false}>
          <motion.div
            key='initial-signup-options'
            variants={switchContentVariants}
            initial='hidden'
            animate='visible'
            exit='exit'
            layout
            className='flex w-full flex-col space-y-4'
          >
            <SignUpForm />
            <div className='space-y-1 px-4 pt-4 text-center text-sm text-muted-foreground'>
              <p>By signing up, you agree to our </p>
              <p>
                <Link to='/signup' className='text-foreground underline-offset-4 hover:underline'>
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link to='/signup' className='text-foreground underline-offset-4 hover:underline'>
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
            <p className='pt-4 text-center text-sm text-muted-foreground'>
              Already have an account?{' '}
              <Link
                to='/login'
                className='text-foreground underline-offset-4 hover:underline'
                data-testid='login-link'
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
