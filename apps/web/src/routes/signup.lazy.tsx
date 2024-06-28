import {Link, createLazyFileRoute} from '@tanstack/react-router';
import {Separator} from '@/components/ui/separator';
import {SignUpForm} from '@/components/signup-form';
import {LogoLink} from '@/components/logo-link';

export const Route = createLazyFileRoute('/signup')({
  component: SignUp,
});

function SignUp() {
  return (
    <div className='flex h-screen justify-center items-center mx-6'>
      <div className='mx-auto flex w-full flex-col justify-center max-w-96'>
        <div className='flex flex-col items-center'>
          <LogoLink />
          <h1 className='text-2xl font-semibold mb-12 text-center'>Create your account</h1>
        </div>
        <SignUpForm />
        <div className='text-sm space-y-6 mt-6 text-center'>
          <div>
            <p>By signing up, you agree to our </p>
            <p>
              <Link
                to='/signup'
                className='text-sm hover:underline underline-offset-4 font-medium text-accent-foreground'
              >
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link
                to='/signup'
                className='text-sm hover:underline underline-offset-4 font-medium text-accent-foreground'
              >
                Privacy Policy
              </Link>
            </p>
          </div>
          <div className='flex justify-center'>
            <Separator className='w-1/4' />
          </div>
          <p className='text-sm'>
            Already have an account?{' '}
            <Link
              to='/login'
              className='text-sm hover:underline underline-offset-4 font-medium text-accent-foreground'
            >
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
