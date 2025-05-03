import {Link, createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {AnimatePresence, motion} from 'framer-motion';
import {Info} from 'lucide-react';
import {z} from 'zod';

import {AuthLayout} from '@/features/auth/components/auth-layout';
import {LogInForm} from '@/features/auth/components/login-form';
import {switchContentVariants} from '@/features/auth/constants/animations';
import {handleUnauthenticatedRedirect} from '@/utils/handle-redirect';

const searchParamsSchema = z.object({
  returnTo: z.string().optional(),
});

export const Route = createFileRoute('/login')({
  component: LogIn,
  validateSearch: zodValidator(searchParamsSchema),
  beforeLoad: ({context}) => {
    handleUnauthenticatedRedirect(context);
  },
});

function LogIn() {
  const searchParams = Route.useSearch();

  return (
    <AuthLayout title='Log in to Flair'>
      {searchParams.returnTo === '/verify' && (
        <motion.div
          layout
          initial={{opacity: 0}}
          animate={{opacity: 1}}
          exit={{opacity: 0}}
          className='flex items-center rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200'
        >
          <Info className='mr-2 h-4 w-4 flex-shrink-0' />
          <span>Please log in to send a new verification code.</span>
        </motion.div>
      )}

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
            <LogInForm returnTo={searchParams.returnTo} />
            <p className='px-8 pt-4 text-center text-sm text-muted-foreground'>
              Don&apos;t have an account?{' '}
              <Link
                to='/signup'
                search={{returnTo: searchParams.returnTo}}
                className='text-foreground underline-offset-4 hover:underline'
              >
                Sign up
              </Link>
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </AuthLayout>
  );
}
