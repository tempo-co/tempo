import {createFileRoute} from '@tanstack/react-router';
import {Trash2} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Separator} from '@/components/ui/separator';
import {Skeleton} from '@/components/ui/skeleton';
import {PasswordChangeDialog} from '@/features/settings/components/password-change/password-change-dialog';
import {SessionList} from '@/features/settings/components/session/session-list';
import {useCurrentUser} from '@/hooks/use-current-user';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/settings/security/')({
  component: SettingsSecurityIndex,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function SettingsSecurityIndex() {
  const {currentUser} = useCurrentUser({skipFetch: true});

  if (!currentUser) {
    return <Skeleton className='h-[19.5rem] w-full rounded-lg bg-card' />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>Manage your account&apos;s security settings.</CardDescription>
      </CardHeader>
      <CardContent>
        <Separator className='mb-6 bg-muted' />
        <SessionList />
        <Separator className='my-6 bg-muted' />
        <div className='mt-4'>
          <div className='flex flex-col items-start justify-between sm:flex-row sm:items-center'>
            <div>
              <h2 className='mb-1 text-lg font-medium'>Password</h2>
              <p className='mr-8 text-sm text-muted-foreground'>
                Change your account&apos;s password.
              </p>
            </div>
            <PasswordChangeDialog />
          </div>
        </div>
        <Separator className='my-6 bg-muted' />
        <div className='mt-4'>
          <div className='flex flex-col items-start justify-between sm:flex-row sm:items-center'>
            <div>
              <h2 className='mb-1 text-lg font-medium'>Delete account</h2>
              <p className='mr-8 text-sm text-muted-foreground'>
                Deleting your account cannot be undone. Please be certain.
              </p>
            </div>
            <Button variant='destructive' className='mt-4 w-full text-foreground sm:mt-0 sm:w-fit'>
              <Trash2 />
              Delete account
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
