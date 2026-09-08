import {createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {AppHeaderLayout} from '@/components/shared/layout/app-header-layout';
import {LoadingBar} from '@/components/shared/loading-bar';
import {useGetBankTransactions} from '@/features/banking/api/use-get-bank-transactions';
import {BankTransactionBreadcrumb} from '@/features/banking/components/bank-transaction-breadcrumb';
import {BankTransactionDetailsDialog} from '@/features/banking/components/bank-transaction-details-dialog';
import {BankTransactionTable} from '@/features/banking/components/bank-transaction-table';
import {bankTransactionSearchParamsSchema} from '@/features/banking/types/bank-transaction';
import {useBankTransactionInspector} from '@/hooks/use-bank-transaction-inspector';
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
  const transactionId = searchParams.transactionId;
  const {openTransaction, closeTransaction} = useBankTransactionInspector('/bank-transactions/');
  const {
    data,
    isPending,
    isPlaceholderData,
    isError,
    refetch,
    pagination,
    setPagination,
    filters,
    setFilters,
    sort,
    setSort,
  } = useGetBankTransactions(searchParams);
  const totalTransactions = data?.total ?? 0;
  const transactionCountLabel = totalTransactions === 1 ? 'transaction' : 'transactions';
  const resultSummary = isPending
    ? 'Loading synchronized records...'
    : isError
      ? 'Transaction data is unavailable right now'
      : `${totalTransactions} ${transactionCountLabel}`;

  return (
    <>
      <LoadingBar isPending={isPending} />
      <AppHeaderLayout>
        <BankTransactionBreadcrumb />
      </AppHeaderLayout>
      <AppBodyLayout className='max-md:my-6'>
        <div className='space-y-6 max-md:space-y-4'>
          <div
            data-testid='bank-transactions-heading'
            className='max-md:flex max-md:flex-wrap max-md:items-baseline max-md:justify-between max-md:gap-x-3 max-md:gap-y-1'
          >
            <h1 className='text-2xl font-semibold tracking-tight'>Bank transactions</h1>
            <p className='mt-1 text-sm text-muted-foreground max-md:mt-0 max-md:text-right'>
              {resultSummary}
            </p>
          </div>
          <BankTransactionTable
            transactions={data?.transactions || []}
            totalTransactions={totalTransactions}
            isPending={isPending}
            isPlaceholderData={isPlaceholderData}
            pagination={pagination}
            setPagination={setPagination}
            filters={filters}
            setFilters={setFilters}
            sort={sort}
            setSort={setSort}
            isError={isError}
            onRetry={() => void refetch()}
            onTransactionSelect={openTransaction}
          />
        </div>
      </AppBodyLayout>
      <BankTransactionDetailsDialog
        transactionId={transactionId ?? ''}
        open={Boolean(transactionId)}
        onOpenChange={closeTransaction}
      />
    </>
  );
}
