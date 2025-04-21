import {createFileRoute} from '@tanstack/react-router';

import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Separator} from '@/components/ui/separator';
import {Skeleton} from '@/components/ui/skeleton';
import {EmailChangeDialog} from '@/features/settings/components/email-change/email-change-dialog';
import {NameChangeForm} from '@/features/settings/components/name-change-form';
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
    return <Skeleton className='h-[23.3rem] w-full rounded-lg bg-card' />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Manage your account&apos;s settings.</CardDescription>
      </CardHeader>
      <CardContent>
        <Separator className='mb-6 bg-muted' />
        <div>
          <h2 className='mb-1 text-lg font-medium'>Name</h2>
          <div className='w-fit'>
            <NameChangeForm currentName={currentUser.name} />
          </div>
        </div>
        <Separator className='my-6 bg-muted' />
        <div className='flex flex-col items-start justify-between md:flex-row md:items-center'>
          <div>
            <h2 className='mb-1 text-lg font-medium'>Email address</h2>
            <p className='mr-8 text-sm text-muted-foreground'>{currentUser.email}</p>
          </div>
          <EmailChangeDialog currentEmail={currentUser.email} />
        </div>
      </CardContent>
    </Card>
  );
}
