import {createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {AppHeaderLayout} from '@/components/shared/layout/app-header-layout';
import {LoadingBar} from '@/components/shared/loading-bar';
import {useGetBankTransactions} from '@/features/banking/api/use-get-bank-transactions';
import {BankTransactionBreadcrumb} from '@/features/banking/components/bank-transaction-breadcrumb';
import {BankTransactionTable} from '@/features/banking/components/bank-transaction-table';
import {bankTransactionSearchParamsSchema} from '@/features/banking/types/bank-transaction';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/bank-transactions/')({
  component: BankTransactionsIndex,
  validateSearch: zodValidator(bankTransactionSearchParamsSchema),
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function BankTransactionsIndex() {
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
  } = useGetBankTransactions(searchParams);

  return (
    <>
      <LoadingBar isPending={isPending} />
      <AppHeaderLayout>
        <BankTransactionBreadcrumb />
      </AppHeaderLayout>
      <AppBodyLayout>
        <BankTransactionTable
          transactions={data?.transactions || []}
          totalTransactions={data?.total || 0}
          isPending={isPending}
          isPlaceholderData={isPlaceholderData}
          pagination={pagination}
          setPagination={setPagination}
          filters={filters}
          setFilters={setFilters}
          sort={sort}
          setSort={setSort}
        />
      </AppBodyLayout>
    </>
  );
}
