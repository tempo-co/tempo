import {createFileRoute, redirect} from '@tanstack/react-router';

import {AppBody} from '@/components/shared/layout/app-body';
import {AppHeader} from '@/components/shared/layout/app-header';
import {useGetAllAccounts} from '@/features/account/api/use-get-all-accounts';
import {AccountBreadcrumb} from '@/features/account/components/account-breadcrumb';
import {AccountList} from '@/features/account/components/account-list';

export const Route = createFileRoute('/accounts/')({
  component: AccountsIndex,
  beforeLoad: ({context}) => {
    if (!context.isAuthenticated) {
      throw redirect({to: '/login'});
    }
  },
});

function AccountsIndex() {
  const {accounts} = useGetAllAccounts();

  return (
    <>
      <AppHeader>
        <AccountBreadcrumb />
      </AppHeader>
      <AppBody>
        <AccountList accounts={accounts || []} />
      </AppBody>
    </>
  );
}
