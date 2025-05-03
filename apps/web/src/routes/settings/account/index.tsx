import {createFileRoute} from '@tanstack/react-router';

import {Card} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import {EmailChangeDialog} from '@/features/settings/components/email-change/email-change-dialog';
import {UsernameChangeForm} from '@/features/settings/components/username-change-form';
import {useCurrentUser} from '@/hooks/use-current-user';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/settings/account/')({
  component: SettingsAccountIndex,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function SettingsAccountIndex() {
  const {currentUser} = useCurrentUser({skipFetch: true});

  if (!currentUser) {
    return <Skeleton className='h-[18rem] w-full rounded-lg bg-card' />;
  }

  return (
    <div className='w-full'>
      <h1 className='mb-6 text-2xl font-medium'>Account</h1>
      <div className='space-y-8'>
        <div>
          <div className='mb-4'>
            <h2 className='mb-1 text-lg font-medium'>Username</h2>
            <p className='mr-8 text-sm text-muted-foreground'>
              Your display name as it appears in the application.
            </p>
          </div>
          <Card className='p-4'>
            <UsernameChangeForm currentUsername={currentUser.username} />
          </Card>
        </div>

        <div>
          <div className='mb-4'>
            <h2 className='mb-1 text-lg font-medium'>Email</h2>
            <p className='mr-8 text-sm text-muted-foreground'>
              The email address associated with your account.
            </p>
          </div>
          <div className='flex items-center justify-between gap-4 rounded-lg border bg-card p-4 sm:items-center'>
            <div>
              <p className='text-sm font-medium'>{currentUser.email}</p>
              <p className='mt-1 text-xs text-muted-foreground'>
                Primary contact for account recovery and important notifications.
              </p>
            </div>
            <div className='flex-shrink-0'>
              <EmailChangeDialog currentEmail={currentUser.email} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
