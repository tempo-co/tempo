import {createFileRoute, redirect} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';

import {AppBody} from '@/components/shared/layout/app-body';
import {AppHeader} from '@/components/shared/layout/app-header';
import {useGetAllTransactions} from '@/features/transactions/api/use-get-all-transactions';
import {TransactionBreadcrumb} from '@/features/transactions/components/transaction-breadcrumb';
import {TransactionsTable} from '@/features/transactions/components/transaction-table';
import {searchParamsSchema} from '@/features/transactions/types/search-params';

export const Route = createFileRoute('/transactions/')({
  component: TransactionsIndex,
  validateSearch: zodValidator(searchParamsSchema),
  beforeLoad: ({context}) => {
    if (!context.isAuthenticated) {
      throw redirect({to: '/login', search: {redirect: location.href}});
    }
  },
});

function TransactionsIndex() {
  const searchParams = Route.useSearch();
  const {data, isPending, isPlaceholderData, pagination, setPagination, filters, setFilters} =
    useGetAllTransactions(searchParams);

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
