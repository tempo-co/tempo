import {useMemo} from 'react';

import {savedDataStatus} from '@/utils/query-status';

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
 * Active accounts across all bank connections, plus whether an account shares its bank and currency with
 * another active account and therefore needs its own name to be told apart.
 */
export const useActiveBankAccounts = () => {
  const {bankConnections, ...query} = useGetAllBankConnections();
  const {isPending, isError} = savedDataStatus({...query, data: bankConnections});

  // Inactive accounts keep their transactions, so rows look their account up among all of them.
  const accountsById = useMemo(
    () =>
      new Map(
        bankConnections?.flatMap((connection) =>
          connection.bankAccounts.map((account) => [
            account.id,
            {
              id: account.id,
              label: resolveBankAccountLabel(account),
              bankName: connection.aspspName,
              currency: account.currency,
              isActive: account.isActive,
            },
          ]),
        ),
      ),
    [bankConnections],
  );
  const accounts = useMemo<ActiveBankAccount[]>(
    () =>
      [...accountsById.values()]
        .filter((account) => account.isActive)
        .map(({id, label, bankName, currency}) => ({id, label, bankName, currency})),
    [accountsById],
  );
  const ambiguousKeys = useMemo(() => findAmbiguousBankAccountKeys(accounts), [accounts]);
  const activeKeys = useMemo(() => new Set(accounts.map(bankAccountLabelKey)), [accounts]);

  /** An inactive account needs its name when an active one shares its bank and currency; an unknown one never does. */
  const needsAccountName = (accountId: string) => {
    const account = accountsById.get(accountId);
    if (!account) return false;
    const key = bankAccountLabelKey(account);
    return account.isActive ? ambiguousKeys.has(key) : activeKeys.has(key);
  };

  // The Filters panel offers accounts unless the owner is known to have a single one.
  const showsAccountFilter = isPending || isError || accounts.length > 1;

  return {accounts, needsAccountName, showsAccountFilter, isPending, isError};
};
