import {Link, createFileRoute, redirect} from '@tanstack/react-router';

import {Separator} from '@/components/ui/separator';
import {LogInForm} from '@/features/auth/components/login-form';
import {LogoLink} from '@/features/auth/components/logo-link';

export const Route = createFileRoute('/login')({
  component: LogIn,
  beforeLoad: ({context}) => {
    if (context.isAuthenticated) {
      throw redirect({to: '/home'});
    }
  },
});

function LogIn() {
  return (
    <div className='mx-6 flex h-screen items-center justify-center'>
      <div className='mx-auto flex w-full max-w-96 flex-col justify-center'>
        <div className='flex flex-col items-center'>
          <LogoLink />
          <h1 className='mb-12 text-center text-2xl font-semibold'>Log in</h1>
        </div>
        <LogInForm />
        <div className='mt-6 space-y-6 text-sm'>
          <div className='flex justify-center'>
            <Separator className='w-1/5' />
          </div>
          <p className='text-center text-sm'>
            New to Flair?{' '}
            <Link
              to='/signup'
              className='text-sm font-medium underline decoration-accent underline-offset-4 hover:decoration-foreground'
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
