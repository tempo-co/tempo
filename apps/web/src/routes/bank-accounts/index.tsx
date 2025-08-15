import {createFileRoute} from '@tanstack/react-router';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {AppHeaderLayout} from '@/components/shared/layout/app-header-layout';
import {LoadingBar} from '@/components/shared/loading-bar';
import {useGetAllBankAccounts} from '@/features/bank-account/api/use-get-all-accounts';
import {BankAccountBreadcrumb} from '@/features/bank-account/components/bank-account-breadcrumb';
import {BankAccountList} from '@/features/bank-account/components/bank-account-list';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/bank-accounts/')({
  component: BankAccountsIndex,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function BankAccountsIndex() {
  const {bankAccounts, isPending} = useGetAllBankAccounts();

  return (
    <>
      <LoadingBar isPending={isPending} />
      <AppHeaderLayout>
        <BankAccountBreadcrumb />
      </AppHeaderLayout>
      <AppBodyLayout>
        <BankAccountList bankAccounts={bankAccounts || []} isPending={isPending} />
      </AppBodyLayout>
    </>
  );
}
