import {createFileRoute} from '@tanstack/react-router';

import {useGetAccount} from '@/features/accounts/api/use-get-account';
import {AccountsBreadcrumb} from '@/features/accounts/components/accounts-breadcrumb';
import {useGetAllBankStatements} from '@/features/bank-statements/api/use-get-all-bank-statements';
import {BankStatementUploadInput} from '@/features/bank-statements/components/bank-statement-upload-input';
import {BankStatementsTable} from '@/features/bank-statements/components/bank-statements-table';

export const Route = createFileRoute(
  '/(accounts)/(statements)/accounts/$accountId/bank-statements/',
)({
  component: BankStatementsIndex,
});

function BankStatementsIndex() {
  const {accountId} = Route.useParams();

  const {account, isPending: isAccountPending} = useGetAccount(accountId);
  const {bankStatements, isPending: isBankStatementsPending} = useGetAllBankStatements(accountId);

  return (
    <div>
      {isAccountPending && <AccountsBreadcrumb />}
      {account && <AccountsBreadcrumb account={account} bankStatements />}
      {isBankStatementsPending && <p>Loading bank statements...</p>}
      {bankStatements && (
        <div className='mb-5'>
          {bankStatements.length > 0 ? (
            <BankStatementsTable bankStatements={bankStatements} />
          ) : (
            <p>No bank statements uploaded yet.</p>
          )}
        </div>
      )}
      <BankStatementUploadInput />
    </div>
  );
}
