import {useMutation, useQueryClient} from '@tanstack/react-query';
import type {BankAccount, BankConnection, SetBankAccountBalanceRequest} from '@tempo/contracts';

import {bankQueryKeys} from '@/features/banking/api/query-keys';
import {bankConnectionsQueryOptions} from '@/features/banking/api/use-get-all-bank-connections';
import {api} from '@/utils/api';

import {invalidateAfterImportChange} from './use-bank-imports';

/**
 * Enters the balance an imported-files account has today; earlier balances follow from its transactions. The
 * account's connection is looked up in the connection list, read again when the account is not in it yet (an
 * account the import just created).
 */
export function useSetAccountBalance() {
  const queryClient = useQueryClient();
  const {mutateAsync, isPending} = useMutation({
    mutationFn: async ({accountId, amount}: {accountId: string; amount: string}) => {
      const connectionOf = (connections: BankConnection[] | undefined) =>
        connections?.find(({bankAccounts}) => bankAccounts.some(({id}) => id === accountId))?.id;
      const connectionId =
        connectionOf(queryClient.getQueryData(bankQueryKeys.connections)) ??
        connectionOf(await queryClient.fetchQuery({...bankConnectionsQueryOptions, staleTime: 0}));
      if (!connectionId) throw new AccountGoneError();
      return api.put<BankAccount>(
        `/bank-connections/${connectionId}/accounts/${accountId}/balance`,
        {amount} satisfies SetBankAccountBalanceRequest,
      );
    },
    onSuccess: (account) => {
      // The account shows its balance at once; the reload brings everything that follows from it.
      queryClient.setQueryData<BankConnection[]>(bankQueryKeys.connections, (connections) =>
        connections?.map((connection) => ({
          ...connection,
          bankAccounts: connection.bankAccounts.map((existing) =>
            existing.id === account.id ? account : existing,
          ),
        })),
      );
    },
    onSettled: () => invalidateAfterImportChange(queryClient),
  });
  return {setAccountBalance: mutateAsync, isPending};
}

/** The account is no longer among the owner's, for example after an undo elsewhere. */
export class AccountGoneError extends Error {
  constructor() {
    super('Bank account not found.');
    this.name = 'AccountGoneError';
  }
}
