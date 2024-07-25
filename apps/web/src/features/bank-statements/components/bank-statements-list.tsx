import {useParams} from '@tanstack/react-router';

import {useGetAccount} from '@/features/accounts/api/use-get-account';
import {AccountsBreadcrumb} from '@/features/accounts/components/accounts-breadcrumb';
import {useGetAllBankStatements} from '@/features/bank-statements/api/use-get-all-bank-statements';
import {BankStatementUploadInput} from '@/features/bank-statements/components/bank-statement-upload-input';

import {BankStatementsTable} from './bank-statements-table';

export function BankStatementsList() {
  const {accountId} = useParams({from: '/accounts/$accountId/bank-statements'});

  const {account, isPending: isAccountPending} = useGetAccount(accountId);
  const {bankStatements, isPending: isBankStatementsPending} = useGetAllBankStatements(accountId);

  return (
    <div className='max-w-4xl'>
      {isAccountPending && <AccountsBreadcrumb />}
      {account && <AccountsBreadcrumb account={account} bankStatements />}
      {isBankStatementsPending && <p>Loading bank statements...</p>}
      {bankStatements && (
        <div>
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
