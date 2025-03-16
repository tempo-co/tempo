import {createFileRoute} from '@tanstack/react-router';

import {BackButton} from '@/components/shared/back-button';
import {AppBody} from '@/components/shared/layout/app-body';
import {AppHeader} from '@/components/shared/layout/app-header';
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
      <AppHeader>
        <TransactionBreadcrumb transaction={transaction} />
      </AppHeader>
      <AppBody>
        <BackButton className='mt-4' />
        <TransactionCard transaction={transaction} isPending={isPending} />
      </AppBody>
    </>
  );
}
