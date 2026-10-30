import {Link, createFileRoute} from '@tanstack/react-router';

import {Button} from '@/components/ui/button';
import {AuthLayout} from '@/features/auth/components/auth-layout';
import {FadeSwitch} from '@/features/auth/components/fade-switch';
import {SignUpForm} from '@/features/auth/components/signup-form';
import {handleUnauthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/signup')({
  component: SignUp,
  beforeLoad: ({context}) => {
    handleUnauthenticatedRedirect(context);
  },
});

function SignUp() {
  return (
    <AuthLayout title='Create your Tempo account'>
      <FadeSwitch
        viewKey='initial-signup-options'
        wrapperClassName='relative flex flex-col space-y-3'
        layout
        className='flex w-full flex-col'
      >
        <SignUpForm />
        <div className='px-2 pt-2 text-center text-xs leading-5 text-muted-foreground'>
          <p>
            By signing up, you agree to our{' '}
            <Button variant='link' asChild className='h-fit px-1 py-0'>
              <Link to='/signup' className='text-foreground'>
                Terms of Service
              </Link>
            </Button>{' '}
            and{' '}
            <Button variant='link' asChild className='h-fit px-1 py-0'>
              <Link to='/signup' className='text-foreground'>
                Privacy Policy.
              </Link>
            </Button>
          </p>
        </div>
        <p className='pt-1 text-center text-sm text-muted-foreground'>
          Already have an account?{' '}
          <Button variant='link' asChild className='h-fit px-1 py-0'>
            <Link to='/login' className='text-foreground' data-testid='login-link'>
              Log in
            </Link>
          </Button>
        </p>
      </FadeSwitch>
    </AuthLayout>
  );
}
