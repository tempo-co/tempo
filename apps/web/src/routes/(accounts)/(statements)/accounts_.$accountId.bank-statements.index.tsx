import {createFileRoute} from '@tanstack/react-router';
import {fallback, zodValidator} from '@tanstack/zod-adapter';
import {z} from 'zod';

import {useGetAccount} from '@/features/accounts/api/use-get-account';
import {AccountsBreadcrumb} from '@/features/accounts/components/accounts-breadcrumb';
import {useGetAllBankStatements} from '@/features/bank-statements/api/use-get-all-bank-statements';
import {BankStatementCalendarView} from '@/features/bank-statements/components/bank-statement-calendar-view';
import {BankStatementTable} from '@/features/bank-statements/components/bank-statement-table';
import {BankStatementUploadDialog} from '@/features/bank-statements/components/bank-statement-upload-dialog';

const paginationSchema = z.object({
  pageIndex: fallback(z.number(), 0).default(0),
  pageSize: fallback(z.number(), 10).default(10),
});

export const Route = createFileRoute(
  '/(accounts)/(statements)/accounts_/$accountId/bank-statements/',
)({
  component: BankStatementsIndex,
  validateSearch: zodValidator(paginationSchema),
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
      {isAccountPending && <AccountsBreadcrumb />}
      {account && <AccountsBreadcrumb account={account} bankStatements />}
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
    </>
  );
}
