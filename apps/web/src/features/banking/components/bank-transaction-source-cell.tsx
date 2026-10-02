import {useMemo} from 'react';

import {useGetAllBankConnections} from '../api/use-get-all-bank-connections';
import {BankTransaction} from '../types/bank-transaction';
import {bankAccountLabelKey, findAmbiguousBankAccountKeys} from '../utils/bank-account-label';
import {resolveBankTransactionAccountLabel} from '../utils/formatters';

type BankTransactionSourceCellProps = {
  transaction: BankTransaction;
};

export function BankTransactionSourceCell({transaction}: BankTransactionSourceCellProps) {
  const {bankConnections} = useGetAllBankConnections();
  const ambiguousAccountKeys = useMemo(
    () =>
      findAmbiguousBankAccountKeys(
        bankConnections?.flatMap((connection) =>
          connection.bankAccounts
            .filter((account) => account.isActive)
            .map((account) => ({bankName: connection.aspspName, currency: account.currency})),
        ) ?? [],
      ),
    [bankConnections],
  );
  const isAmbiguous = ambiguousAccountKeys.has(
    bankAccountLabelKey({bankName: transaction.bankName, currency: transaction.currency}),
  );

  return (
    <div className='w-full min-w-0'>
      <p className='truncate'>{transaction.bankName}</p>
      <p className='truncate text-xs text-muted-foreground'>
        {transaction.currency}
        {isAmbiguous && ` · ${resolveBankTransactionAccountLabel(transaction)}`}
      </p>
    </div>
  );
}
