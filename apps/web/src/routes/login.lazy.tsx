import {LogInForm} from '@/components/login-form';
import {LogoLink} from '@/components/logo-link';
import {Separator} from '@/components/ui/separator';
import {Link, createLazyFileRoute} from '@tanstack/react-router';

export const Route = createLazyFileRoute('/login')({
  component: LogIn,
});

function LogIn() {
  return (
    <div className='flex h-screen justify-center items-center mx-6'>
      <div className='mx-auto flex w-full flex-col justify-center max-w-96'>
        <div className='flex flex-col items-center'>
          <LogoLink />
          <h1 className='text-2xl font-semibold mb-12 text-center'>Log in</h1>
        </div>
        <LogInForm />
        <div className='text-sm space-y-6 mt-6'>
          <div className='flex justify-center'>
            <Separator className='w-1/5' />
          </div>
          <p className='text-sm text-center'>
            New to Flair?{' '}
            <Link
              to='/signup'
              className='text-sm underline decoration-accent hover:decoration-foreground underline-offset-4 font-medium'
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
