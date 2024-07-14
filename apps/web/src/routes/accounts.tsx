import {createFileRoute, redirect} from '@tanstack/react-router';

import {AccountsList} from '@/features/accounts/components/accounts-list';

export const Route = createFileRoute('/accounts')({
  component: Accounts,
  beforeLoad: ({context}) => {
    if (!context.isAuthenticated) {
      throw redirect({to: '/login'});
    }
  },
});

function Accounts() {
  return <AccountsList />;
}
