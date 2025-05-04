import {Link, createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {AnimatePresence, motion} from 'framer-motion';
import {z} from 'zod';

import {AuthLayout} from '@/features/auth/components/auth-layout';
import {LogInForm} from '@/features/auth/components/login-form';
import {switchContentVariants} from '@/features/auth/constants/animations';
import {handleUnauthenticatedRedirect} from '@/utils/handle-redirect';

const searchParamsSchema = z.object({
  showVerifyMessage: z.boolean().optional(),
});

export const Route = createFileRoute('/login')({
  component: LogIn,
  validateSearch: zodValidator(searchParamsSchema),
  beforeLoad: ({context}) => {
    handleUnauthenticatedRedirect(context);
  },
});

function LogIn() {
  return (
    <AuthLayout title='Log in to Flair'>
      <div className='relative flex min-h-[180px] flex-col'>
        <AnimatePresence mode='wait' initial={false}>
          <motion.div
            key='initial-options'
            variants={switchContentVariants}
            initial='hidden'
            animate='visible'
            exit='exit'
            layout
            className='flex w-full flex-col space-y-4'
          >
            <LogInForm />
            <p className='px-8 pt-4 text-center text-sm text-muted-foreground'>
              Don&apos;t have an account?{' '}
              <Link to='/signup' className='text-foreground underline-offset-4 hover:underline'>
                Sign up
              </Link>
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </AuthLayout>
  );
}
