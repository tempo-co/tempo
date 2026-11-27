import {useMutation, useQueryClient} from '@tanstack/react-query';
import type {
  BankAccount,
  BankAccountRemoveRequest,
  BankConnection,
  UpdateBankAccountRequest,
} from '@tempo/contracts';

import {invalidateBankDerivedData} from '@/features/banking/api/invalidate-bank-derived-data';
import {bankQueryKeys} from '@/features/banking/api/query-keys';
import {invalidateAfterImportChange} from '@/features/file-import/api/use-bank-imports';
import {HttpError, api} from '@/utils/api';

type AccountRef = {connectionId: BankConnection['id']; accountId: BankAccount['id']};

/**
 * Renames an account or hides it (or shows it again). The account shows the saved values at once; hiding also reads
 * every total again, since none of them counts a hidden account's rows.
 */
export function useUpdateBankAccount() {
  const queryClient = useQueryClient();
  const {mutateAsync, isPending, variables} = useMutation<
    BankAccount,
    HttpError,
    AccountRef & UpdateBankAccountRequest
  >({
    mutationFn: ({connectionId, accountId, ...body}) =>
      api.patch<BankAccount>(
        `/bank-connections/${connectionId}/accounts/${accountId}`,
        body satisfies UpdateBankAccountRequest,
      ),
    onSuccess: async (account, {isHidden}) => {
      queryClient.setQueryData<BankConnection[]>(bankQueryKeys.connections, (connections) =>
        connections?.map((connection) => ({
          ...connection,
          bankAccounts: connection.bankAccounts.map((existing) =>
            existing.id === account.id ? account : existing,
          ),
        })),
      );
      // A new name shows on every row of the account; hiding changes every total too.
      await Promise.all([
        queryClient.invalidateQueries({queryKey: bankQueryKeys.connections}),
        isHidden === undefined
          ? queryClient.invalidateQueries({queryKey: bankQueryKeys.transactionsRoot})
          : invalidateBankDerivedData(queryClient),
      ]);
    },
  });
  return {updateBankAccount: mutateAsync, isPending, variables};
}

export const REMOVE_BANK_ACCOUNT_KEY = ['remove-bank-account'];

/** Deletes an imported-files account with its transactions and the imports only it holds. */
export function useRemoveBankAccount() {
  const queryClient = useQueryClient();
  const {mutateAsync, isPending} = useMutation<void, HttpError, AccountRef>({
    mutationKey: REMOVE_BANK_ACCOUNT_KEY,
    mutationFn: async ({connectionId, accountId}) => {
      await api.delete<void>(`/bank-connections/${connectionId}/accounts/${accountId}`, {
        confirmation: 'DELETE',
      } satisfies BankAccountRemoveRequest);
    },
    onSuccess: () => invalidateAfterImportChange(queryClient),
  });
  return {removeBankAccount: mutateAsync, isPending};
}
