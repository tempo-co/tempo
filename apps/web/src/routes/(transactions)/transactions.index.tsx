import {createFileRoute} from '@tanstack/react-router';
import {fallback, zodValidator} from '@tanstack/zod-adapter';
import {z} from 'zod';

import {TransactionsTable} from '@/features/bank-statements/components/transaction-table';
import {useGetAllTransactions} from '@/features/transactions/api/use-get-all-transactions';

const paginationSchema = z.object({
  pageIndex: fallback(z.number(), 0).default(0),
  pageSize: fallback(z.number(), 10).default(10),
});

export const Route = createFileRoute('/(transactions)/transactions/')({
  component: TransactionsIndex,
  validateSearch: zodValidator(paginationSchema),
});

function TransactionsIndex() {
  const {pageIndex, pageSize} = Route.useSearch();
  const {data, isPending, pagination, setPagination, isPlaceholderData} = useGetAllTransactions({
    pageIndex,
    pageSize,
  });

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
