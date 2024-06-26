import {Link, createLazyFileRoute} from '@tanstack/react-router';
import {Separator} from '@/components/ui/separator';
import {SignUpForm} from '@/components/signup-form';

export const Route = createLazyFileRoute('/signup')({
  component: SignUp,
});

function SignUp() {
  return (
    <div className='flex h-screen justify-center items-center mx-6'>
      <div className='mx-auto flex w-full flex-col justify-center max-w-96'>
        <div className='flex flex-col'>
          <Link to='/' className='flex items-center group mb-12'>
            <img
              src='/src/assets/logo.png'
              alt='Flair logo'
              className='w-8 transition-transform duration-500 group-hover:rotate-90'
            />
            <h1 className='text-4xl font-semibold tracking-tight text-accent-foreground ml-3'>
              Flair
            </h1>
          </Link>
          <h1 className='text-2xl font-semibold'>Create your account</h1>
        </div>
        <SignUpForm />
        <div className='text-sm text-muted-foreground space-y-6 mt-6'>
          <p>
            By signing up, you agree to Flair&apos;s{' '}
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
            .
          </p>
          <div className='flex justify-center'>
            <Separator className='w-1/2' />
          </div>
          <p className='text-sm text-muted-foreground'>
            Already have an account?{' '}
            <Link
              to='/signup'
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
