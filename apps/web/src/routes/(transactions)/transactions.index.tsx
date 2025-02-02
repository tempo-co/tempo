import {createFileRoute} from '@tanstack/react-router';

import {TransactionsTable} from '@/features/bank-statements/components/transaction-table';
import {useGetAllTransactions} from '@/features/transactions/api/use-get-all-transactions';

export const Route = createFileRoute('/(transactions)/transactions/')({
  component: TransactionsIndex,
});

function TransactionsIndex() {
  const {data, isPending, pagination, setPagination, isPlaceholderData} = useGetAllTransactions();

  return (
    <TransactionsTable
      transactions={data ? data.transactions : []}
      totalTransactions={data ? data.total : 0}
      pagination={pagination}
      setPagination={setPagination}
      isPlaceholderData={isPlaceholderData}
      isPending={isPending}
    />
  );
}
