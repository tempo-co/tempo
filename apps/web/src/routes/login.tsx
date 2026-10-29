import {Link, createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {z} from 'zod';

import {Button} from '@/components/ui/button';
import {AuthLayout} from '@/features/auth/components/auth-layout';
import {FadeSwitch} from '@/features/auth/components/fade-switch';
import {LogInForm} from '@/features/auth/components/login-form';
import {handleUnauthenticatedRedirect} from '@/utils/handle-redirect';

const searchParamsSchema = z.object({
  showVerifyMessage: z.boolean().optional(),
  // Same-origin path to resume after login; protocol-relative and backslash tricks are dropped.
  redirect: z
    .string()
    .regex(/^\/(?![/\\])/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/login')({
  component: LogIn,
  validateSearch: zodValidator(searchParamsSchema),
  beforeLoad: ({context}) => {
    handleUnauthenticatedRedirect(context);
  },
});

function LogIn() {
  const {redirect} = Route.useSearch();

  return (
    <AuthLayout title='Log in to Tempo'>
      <FadeSwitch
        viewKey='initial-options'
        wrapperClassName='relative flex flex-col space-y-3'
        layout
        className='flex w-full flex-col'
      >
        <LogInForm redirectTo={redirect} />
        <p className='pt-3 text-center text-sm text-muted-foreground'>
          Don&apos;t have an account?{' '}
          <Button variant='link' asChild className='h-fit px-1 py-0'>
            <Link to='/signup' className='text-foreground' data-testid='signup-link'>
              Sign up
            </Link>
          </Button>
        </p>
      </FadeSwitch>
    </AuthLayout>
  );
}
