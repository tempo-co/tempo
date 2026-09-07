import {createFileRoute} from '@tanstack/react-router';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {AppHeaderLayout} from '@/components/shared/layout/app-header-layout';
import {LoadingBar} from '@/components/shared/loading-bar';
import {useGetBankTransaction} from '@/features/banking/api/use-get-bank-transaction';
import {BankTransactionBreadcrumb} from '@/features/banking/components/bank-transaction-breadcrumb';
import {BankTransactionCard} from '@/features/banking/components/bank-transaction-card';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/bank-transactions/$transactionId/')({
  component: BankTransactionIndex,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function BankTransactionIndex() {
  const {transactionId} = Route.useParams();
  const {transaction, isPending} = useGetBankTransaction(transactionId);

  return (
    <>
      <LoadingBar isPending={isPending} />
      <AppHeaderLayout>
        <BankTransactionBreadcrumb transaction={transaction} />
      </AppHeaderLayout>
      <AppBodyLayout>
        <BankTransactionCard transaction={transaction} isPending={isPending} />
      </AppBodyLayout>
    </>
  );
}
