import {createFileRoute, redirect} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';

import {AppBody} from '@/components/shared/layout/app-body';
import {AppHeader} from '@/components/shared/layout/app-header';
import {useGetAccount} from '@/features/account/api/use-get-account';
import {AccountBreadcrumb} from '@/features/account/components/account-breadcrumb';
import {useGetAllBankStatements} from '@/features/bank-statement/api/use-get-all-bank-statements';
import {BankStatementCalendarView} from '@/features/bank-statement/components/bank-statement-calendar-view';
import {BankStatementTable} from '@/features/bank-statement/components/bank-statement-table/bank-statement-table';
import {BankStatementUploadDialog} from '@/features/bank-statement/components/bank-statement-upload/bank-statement-upload-dialog';
import {paginationSearchParamsSchema} from '@/types/pagination';

export const Route = createFileRoute('/accounts/$accountId/bank-statements/')({
  component: BankStatementsIndex,
  validateSearch: zodValidator(paginationSearchParamsSchema),
  beforeLoad: ({context}) => {
    if (!context.isAuthenticated) {
      throw redirect({to: '/login'});
    }
  },
});

function BankStatementsIndex() {
  const {accountId} = Route.useParams();
  const {pageIndex, pageSize} = Route.useSearch();

  const {account, isPending: isAccountPending} = useGetAccount(accountId);
  const {
    data,
    isPending: isBankStatementsPending,
    pagination,
    setPagination,
    isPlaceholderData,
  } = useGetAllBankStatements(accountId, {pageIndex, pageSize});

  return (
    <>
      <AppHeader>
        {isAccountPending && <AccountBreadcrumb />}
        {account && <AccountBreadcrumb account={account} bankStatements />}
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
