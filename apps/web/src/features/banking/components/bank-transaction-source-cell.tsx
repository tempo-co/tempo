import {useMemo} from 'react';

import {useGetAllBankConnections} from '../api/use-get-all-bank-connections';
import {BankTransaction} from '../types/bank-transaction';
import {bankAccountLabelKey, findAmbiguousBankAccountKeys} from '../utils/bank-account-label';
import {resolveBankTransactionAccountLabel} from '../utils/formatters';
import {BankAccountLabel} from './bank-account-label';

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
    <BankAccountLabel
      bankName={transaction.bankName}
      currency={transaction.currency}
      accountName={isAmbiguous ? resolveBankTransactionAccountLabel(transaction) : undefined}
    />
  );
}
