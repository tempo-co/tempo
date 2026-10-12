import {createFileRoute} from '@tanstack/react-router';

import {Skeleton} from '@/components/ui/skeleton';
import {PasswordChangeCard} from '@/features/settings/components/password-change/password-change-card';
import {SessionList} from '@/features/settings/components/session/session-list';
import {useCurrentAccount} from '@/hooks/use-current-account';

export const Route = createFileRoute('/settings/security/')({
  component: SettingsSecurityIndex,
});

function SettingsSecurityIndex() {
  const {currentAccount} = useCurrentAccount({skipFetch: true});

  if (!currentAccount) {
    return <Skeleton className='h-112 w-full rounded-lg bg-card' />;
  }

  return (
    <div className='space-y-10'>
      <PasswordChangeCard />
      <SessionList />
    </div>
  );
}
