import {useMemo} from 'react';

import {bankAccountLabelKey, findAmbiguousBankAccountKeys} from '../utils/bank-account-label';
import {resolveBankAccountLabel} from '../utils/formatters';
import {useGetAllBankConnections} from './use-get-all-bank-connections';

export type ActiveBankAccount = {
  id: string;
  label: string;
  bankName: string;
  currency: string;
};

/**
 * Active accounts across all bank connections, plus whether a bank and currency pair is shared
 * by several accounts and therefore needs the account name to be told apart.
 */
export const useActiveBankAccounts = () => {
  const {bankConnections, isPending, isError} = useGetAllBankConnections();

  const accounts = useMemo<ActiveBankAccount[]>(
    () =>
      bankConnections?.flatMap((connection) =>
        connection.bankAccounts
          .filter((account) => account.isActive)
          .map((account) => ({
            id: account.id,
            label: resolveBankAccountLabel(account),
            bankName: connection.aspspName,
            currency: account.currency,
          })),
      ) ?? [],
    [bankConnections],
  );
  const ambiguousKeys = useMemo(() => findAmbiguousBankAccountKeys(accounts), [accounts]);

  const needsAccountName = (account: {bankName: string; currency: string}) =>
    ambiguousKeys.has(bankAccountLabelKey(account));

  return {accounts, needsAccountName, isPending, isError};
};
