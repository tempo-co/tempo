import {Link, createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {Info} from 'lucide-react';
import {z} from 'zod';

import {Separator} from '@/components/ui/separator';
import {LogInForm} from '@/features/auth/components/login-form';
import {LogoLink} from '@/features/auth/components/logo-link';
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
    <div className='mx-6 flex h-screen items-center justify-center'>
      <div className='mx-auto flex w-full max-w-96 flex-col justify-center'>
        <div className='flex flex-col items-center'>
          <LogoLink />
          <h1 className='mb-12 text-center text-2xl font-semibold'>Log in</h1>
        </div>
        {searchParams.returnTo && searchParams.returnTo == '/verify' && (
          <div className='mb-6 flex items-center rounded-md border border-info bg-info-foreground p-3 text-sm'>
            <Info className='mr-2 h-4 w-4' />
            <span>Please log in to send a new verification code.</span>
          </div>
        )}
        <LogInForm returnTo={searchParams.returnTo} />
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
