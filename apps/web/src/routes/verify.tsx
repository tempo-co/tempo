import {createFileRoute, redirect} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {Mail} from 'lucide-react';
import {toast} from 'sonner';

import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {VerifyForm} from '@/features/auth/components/verify-form';
import {searchParamsSchema} from '@/features/auth/types/email-verify.dto';
import {useCurrentUser} from '@/hooks/use-current-user';

export const Route = createFileRoute('/verify')({
  component: VerifyIndex,
  validateSearch: zodValidator(searchParamsSchema),
  beforeLoad: ({context}) => {
    if (context.isAuthenticated && context.isEmailVerified) {
      toast.info('Your email has already been verified.');
      throw redirect({to: '/home'});
    }
  },
});

function VerifyIndex() {
  const searchParams = Route.useSearch();
  const code = searchParams.code ? String(searchParams.code) : undefined;

  const {currentUser} = useCurrentUser({skipFetch: true});

  return (
    <div className='flex h-screen items-center justify-center'>
      <Card>
        <CardHeader className='flex items-center'>
          <div className='mb-3 rounded-full bg-muted p-3'>
            <Mail className='h-6 w-6' />
          </div>
          <CardTitle>Please check your email</CardTitle>
          <CardDescription className='flex max-w-[21rem] flex-col items-center pt-2'>
            We&apos;ve sent a verification code to{' '}
            {currentUser?.email ? (
              <span className='text-foreground'>{currentUser.email}</span>
            ) : (
              'your email.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VerifyForm code={code} />
        </CardContent>
      </Card>
    </div>
  );
}
