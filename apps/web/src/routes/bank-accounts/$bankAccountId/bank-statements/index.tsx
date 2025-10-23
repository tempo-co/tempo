import {createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {AppHeaderLayout} from '@/components/shared/layout/app-header-layout';
import {Pagination} from '@/components/shared/pagination';
import {useGetBankAccount} from '@/features/bank-account/api/use-get-bank-account';
import {BankAccountBreadcrumb} from '@/features/bank-account/components/bank-account-breadcrumb';
import {useGetAllBankStatements} from '@/features/bank-statement/api/use-get-all-bank-statements';
import {BankStatementGrid} from '@/features/bank-statement/components/bank-statement-grid';
import {
  BANK_STATEMENT_PAGE_SIZE_OPTIONS,
  bankStatementPaginationSearchParamsSchema,
} from '@/features/bank-statement/types/bank-statement-pagination';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/bank-accounts/$bankAccountId/bank-statements/')({
  component: BankStatementsIndex,
  validateSearch: zodValidator(bankStatementPaginationSearchParamsSchema),
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function BankStatementsIndex() {
  const {bankAccountId} = Route.useParams();
  const searchParams = Route.useSearch();
  const {bankAccount, isPending: isBankAccountPending} = useGetBankAccount(bankAccountId);
  const {
    data,
    isPending: isBankStatementsPending,
    pagination,
    setPagination,
    isPlaceholderData,
  } = useGetAllBankStatements(bankAccountId, searchParams);

  return (
    <>
      <AppHeaderLayout>
        {isBankAccountPending && <BankAccountBreadcrumb />}
        {bankAccount && <BankAccountBreadcrumb bankAccount={bankAccount} bankStatements />}
      </AppHeaderLayout>
      <AppBodyLayout>
        <BankStatementGrid
          bankStatements={data?.bankStatements || []}
          isPending={isBankStatementsPending}
          isPlaceholderData={isPlaceholderData}
        />
        {data && data.total > 0 && (
          <Pagination
            totalItems={data.total}
            pagination={pagination}
            setPagination={setPagination}
            navigateOptions={{from: '/bank-accounts/$bankAccountId/bank-statements'}}
            pageSizeOptions={BANK_STATEMENT_PAGE_SIZE_OPTIONS}
          />
        )}
      </AppBodyLayout>
    </>
  );
}
