import {createFileRoute} from '@tanstack/react-router';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {AppHeaderLayout} from '@/components/shared/layout/app-header-layout';
import {LoadingBar} from '@/components/shared/loading-bar';
import {useGetTransaction} from '@/features/transaction/api/use-get-transaction';
import {TransactionBreadcrumb} from '@/features/transaction/components/transaction-breadcrumb';
import {TransactionCard} from '@/features/transaction/components/transaction-card/transaction-card';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/transactions/$transactionId/')({
  component: TransactionIndex,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function TransactionIndex() {
  const {transactionId} = Route.useParams();
  const {transaction, isPending} = useGetTransaction(transactionId);

  return (
    <>
      <LoadingBar isPending={isPending} />
      <AppHeaderLayout>
        <TransactionBreadcrumb transaction={transaction} />
      </AppHeaderLayout>
      <AppBodyLayout>
        <TransactionCard transaction={transaction} isPending={isPending} />
      </AppBodyLayout>
    </>
  );
}
