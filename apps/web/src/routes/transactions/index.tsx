import {createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';

import {AppBody} from '@/components/shared/layout/app-body';
import {AppHeader} from '@/components/shared/layout/app-header';
import {LoadingBar} from '@/components/shared/loading-bar';
import {useGetAllTransactions} from '@/features/transaction/api/use-get-all-transactions';
import {TransactionBreadcrumb} from '@/features/transaction/components/transaction-breadcrumb';
import {TransactionsTable} from '@/features/transaction/components/transaction-table/transaction-table';
import {transactionSearchParamsSchema} from '@/features/transaction/types/search-params';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/transactions/')({
  component: TransactionsIndex,
  validateSearch: zodValidator(transactionSearchParamsSchema),
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function TransactionsIndex() {
  const searchParams = Route.useSearch();
  const {
    data,
    isPending,
    isPlaceholderData,
    pagination,
    setPagination,
    filters,
    setFilters,
    sort,
    setSort,
  } = useGetAllTransactions(searchParams);

  return (
    <>
      <LoadingBar isPending={isPending} />
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
          sort={sort}
          setSort={setSort}
        />
      </AppBody>
    </>
  );
}
