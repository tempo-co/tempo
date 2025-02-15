import {createFileRoute} from '@tanstack/react-router';

import {useGetAccount} from '@/features/accounts/api/use-get-account';
import {AccountsBreadcrumb} from '@/features/accounts/components/accounts-breadcrumb';
import {useGetAllBankStatements} from '@/features/bank-statements/api/use-get-all-bank-statements';
import {BankStatementTable} from '@/features/bank-statements/components/bank-statement-table';
import {BankStatementUploadDialog} from '@/features/bank-statements/components/bank-statement-upload-dialog';

export const Route = createFileRoute(
  '/(accounts)/(statements)/accounts_/$accountId/bank-statements/',
)({
  component: BankStatementsIndex,
});

function BankStatementsIndex() {
  const {accountId} = Route.useParams();

  const {account, isPending: isAccountPending} = useGetAccount(accountId);
  const {
    data,
    isPending: isBankStatementsPending,
    pagination,
    setPagination,
    isPlaceholderData,
  } = useGetAllBankStatements(accountId);

  return (
    <div>
      {isAccountPending && <AccountsBreadcrumb />}
      {account && <AccountsBreadcrumb account={account} bankStatements />}
      <BankStatementTable
        bankStatements={data ? data.bankStatements : []}
        totalBankStatements={data ? data.total : 0}
        pagination={pagination}
        setPagination={setPagination}
        isPlaceholderData={isPlaceholderData}
        isPending={isBankStatementsPending}
      />
      <BankStatementUploadDialog pagination={pagination} />
    </div>
  );
}
