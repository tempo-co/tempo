import {Link, createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {AnimatePresence, motion} from 'framer-motion';
import {z} from 'zod';

import {Button} from '@/components/ui/button';
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
    <AuthLayout title='Log in to Tempo'>
      <div className='relative flex flex-col space-y-3'>
        <AnimatePresence mode='wait' initial={false}>
          <motion.div
            key='initial-options'
            variants={switchContentVariants}
            initial='hidden'
            animate='visible'
            exit='exit'
            layout
            className='flex w-full flex-col'
          >
            <LogInForm />
            <p className='pt-3 text-center text-sm text-muted-foreground'>
              Don&apos;t have an account?{' '}
              <Button variant='link' asChild className='h-fit px-1 py-0'>
                <Link to='/signup' className='text-foreground' data-testid='signup-link'>
                  Sign up
                </Link>
              </Button>
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </AuthLayout>
  );
}
