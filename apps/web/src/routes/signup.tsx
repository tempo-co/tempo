import {Link, createFileRoute, redirect} from '@tanstack/react-router';
import {Separator} from '@/components/ui/separator';
import {LogoLink} from '@/features/auth/components/logo-link';
import {SignUpForm} from '@/features/auth/components/signup-form';

export const Route = createFileRoute('/signup')({
  component: SignUp,
  beforeLoad: ({context}) => {
    if (context.isAuthenticated) {
      throw redirect({to: '/dashboard'});
    }
  },
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
                className='text-sm underline decoration-accent hover:decoration-foreground underline-offset-4 font-medium'
              >
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link
                to='/signup'
                className='text-sm underline decoration-accent hover:decoration-foreground underline-offset-4 font-medium'
              >
                Privacy Policy
              </Link>
              .
            </p>
          </div>
          <div className='flex justify-center'>
            <Separator className='w-1/5' />
          </div>
          <p className='text-sm'>
            Already have an account?{' '}
            <Link
              to='/login'
              className='text-sm underline decoration-accent hover:decoration-foreground underline-offset-4 font-medium'
            >
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
