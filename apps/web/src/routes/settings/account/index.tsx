import {createFileRoute} from '@tanstack/react-router';

import {Card} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import {AccountDelete} from '@/features/settings/components/account-delete/account-delete';
import {EmailChangeDialog} from '@/features/settings/components/email-change/email-change-dialog';
import {NameChangeForm} from '@/features/settings/components/name-change-form';
import {useCurrentAccount} from '@/hooks/use-current-account';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/settings/account/')({
  component: SettingsAccountIndex,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function SettingsAccountIndex() {
  const {currentAccount} = useCurrentAccount({skipFetch: true});

  if (!currentAccount) {
    return <Skeleton className='h-[18rem] w-full rounded-lg bg-card' />;
  }

  return (
    <div className='w-full'>
      <h1 className='mb-8 text-2xl font-semibold tracking-tight'>Account</h1>
      <div className='space-y-10'>
        <section aria-labelledby='name-heading' className='space-y-3'>
          <div className='space-y-1'>
            <h2 id='name-heading' className='text-lg font-semibold'>
              Name
            </h2>
            <p className='max-w-[34rem] text-sm text-muted-foreground'>
              Your display name as it appears in the application.
            </p>
          </div>
          <Card className='p-4 sm:p-5'>
            <NameChangeForm currentName={currentAccount.name} />
          </Card>
        </section>

        <section aria-labelledby='email-heading' className='space-y-3'>
          <div className='space-y-1'>
            <h2 id='email-heading' className='text-lg font-semibold'>
              Email
            </h2>
            <p className='max-w-[34rem] text-sm text-muted-foreground'>
              The email address associated with your account.
            </p>
          </div>
          <div className='flex flex-col gap-4 rounded-card border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5'>
            <div className='min-w-0'>
              <p className='truncate text-sm font-medium'>{currentAccount.email}</p>
              <p className='mt-1 text-xs text-muted-foreground'>
                Primary contact for account recovery and important notifications.
              </p>
            </div>
            <div className='w-full shrink-0 sm:w-auto'>
              <EmailChangeDialog currentEmail={currentAccount.email} />
            </div>
          </div>
        </section>

        <AccountDelete />
      </div>
    </div>
  );
}
