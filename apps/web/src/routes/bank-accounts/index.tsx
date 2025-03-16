import {createFileRoute} from '@tanstack/react-router';

import {BackButton} from '@/components/shared/back-button';
import {AppBody} from '@/components/shared/layout/app-body';
import {AppHeader} from '@/components/shared/layout/app-header';
import {LoadingBar} from '@/components/shared/loading-bar';
import {useGetAllBankAccounts} from '@/features/bank-account/api/use-get-all-accounts';
import {BankAccountAddDialog} from '@/features/bank-account/components/bank-account-add/bank-account-add-dialog';
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
      <AppHeader>
        <BankAccountBreadcrumb />
      </AppHeader>
      <AppBody>
        <div className='mt-4 flex justify-between'>
          <BackButton />
          {bankAccounts && bankAccounts.length !== 0 && <BankAccountAddDialog />}
        </div>
        <BankAccountList bankAccounts={bankAccounts || []} isPending={isPending} />
      </AppBody>
    </>
  );
}
