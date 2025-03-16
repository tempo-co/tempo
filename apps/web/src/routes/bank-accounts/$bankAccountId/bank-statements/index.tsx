import {createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';

import {AppBody} from '@/components/shared/layout/app-body';
import {AppHeader} from '@/components/shared/layout/app-header';
import {useGetBankAccount} from '@/features/bank-account/api/use-get-bank-account';
import {BankAccountBreadcrumb} from '@/features/bank-account/components/bank-account-breadcrumb';
import {useGetAllBankStatements} from '@/features/bank-statement/api/use-get-all-bank-statements';
import {BankStatementCalendarView} from '@/features/bank-statement/components/bank-statement-calendar-view';
import {BankStatementTable} from '@/features/bank-statement/components/bank-statement-table/bank-statement-table';
import {BankStatementUploadDialog} from '@/features/bank-statement/components/bank-statement-upload/bank-statement-upload-dialog';
import {paginationSearchParamsSchema} from '@/types/pagination';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/bank-accounts/$bankAccountId/bank-statements/')({
  component: BankStatementsIndex,
  validateSearch: zodValidator(paginationSearchParamsSchema),
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function BankStatementsIndex() {
  const {bankAccountId} = Route.useParams();
  const {pageIndex, pageSize} = Route.useSearch();

  const {bankAccount, isPending: isBankAccountPending} = useGetBankAccount(bankAccountId);
  const {
    data,
    isPending: isBankStatementsPending,
    pagination,
    setPagination,
    isPlaceholderData,
  } = useGetAllBankStatements(bankAccountId, {pageIndex, pageSize});

  return (
    <>
      <AppHeader>
        {isBankAccountPending && <BankAccountBreadcrumb />}
        {bankAccount && <BankAccountBreadcrumb bankAccount={bankAccount} bankStatements />}
      </AppHeader>
      <AppBody>
        {data && <BankStatementCalendarView bankStatements={data.bankStatements} />}
        <div className='flex flex-col gap-4'>
          {data && data.total > 0 && <BankStatementUploadDialog pagination={pagination} />}
          <BankStatementTable
            bankStatements={data ? data.bankStatements : []}
            totalBankStatements={data ? data.total : 0}
            pagination={pagination}
            setPagination={setPagination}
            isPlaceholderData={isPlaceholderData}
            isPending={isBankStatementsPending}
          />
        </div>
      </AppBody>
    </>
  );
}
