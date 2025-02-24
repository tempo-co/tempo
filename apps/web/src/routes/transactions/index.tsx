import {createFileRoute, redirect} from '@tanstack/react-router';
import {fallback, zodValidator} from '@tanstack/zod-adapter';
import {z} from 'zod';

import {AppBody} from '@/components/shared/layout/app-body';
import {AppHeader} from '@/components/shared/layout/app-header';
import {useGetAllTransactions} from '@/features/transactions/api/use-get-all-transactions';
import {TransactionBreadcrumb} from '@/features/transactions/components/transaction-breadcrumb';
import {TransactionsTable} from '@/features/transactions/components/transaction-table';
import {Category} from '@/types/category';

const paginationSchema = z.object({
  pageIndex: fallback(z.number(), 0).default(0),
  pageSize: fallback(z.number(), 10).default(10),
  categories: z.array(z.nativeEnum(Category)).optional(),
});

export const Route = createFileRoute('/transactions/')({
  component: TransactionsIndex,
  validateSearch: zodValidator(paginationSchema),
  beforeLoad: ({context}) => {
    if (!context.isAuthenticated) {
      throw redirect({to: '/login', search: {redirect: location.href}});
    }
  },
});

function TransactionsIndex() {
  const {pageIndex, pageSize, categories} = Route.useSearch();
  const {data, isPending, isPlaceholderData, pagination, setPagination, filters, setFilters} =
    useGetAllTransactions(
      {
        pageIndex,
        pageSize,
      },
      {
        categories,
      },
    );

  return (
    <>
      <AppHeader>
        <TransactionBreadcrumb />
      </AppHeader>
      <AppBody>
        <TransactionsTable
          transactions={data ? data.transactions : []}
          totalTransactions={data ? data.total : 0}
          isPlaceholderData={isPlaceholderData}
          isPending={isPending}
          pagination={pagination}
          setPagination={setPagination}
          filters={filters}
          setFilters={setFilters}
        />
      </AppBody>
    </>
  );
}
