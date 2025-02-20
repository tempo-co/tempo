import {createFileRoute, useParams} from '@tanstack/react-router';

import {AppBody} from '@/components/shared/layout/app-body';
import {AppHeader} from '@/components/shared/layout/app-header';
import {useGetAccount} from '@/features/accounts/api/use-get-account';
import {AccountBreadcrumb} from '@/features/accounts/components/account-breadcrumb';
import {AccountDetails} from '@/features/accounts/components/account-details';

export const Route = createFileRoute('/(accounts)/accounts/$accountId')({
  component: Account,
});

function Account() {
  const {accountId} = useParams({from: '/(accounts)/accounts/$accountId'});
  const {account} = useGetAccount(accountId);

  return (
    <>
      <AppHeader>
        <AccountBreadcrumb account={account} />
      </AppHeader>
      <AppBody>{account && <AccountDetails account={account} />}</AppBody>
    </>
  );
}
