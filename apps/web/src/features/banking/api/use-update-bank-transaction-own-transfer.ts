import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {HttpError, api} from '@/utils/api';

import {BankTransaction, OwnTransferOverride} from '../types/bank-transaction';
import {bankQueryKeys} from './query-keys';
import {bankTransactionQueryOptions} from './use-get-bank-transaction';

type UpdateBankTransactionOwnTransferInput = {
  id: BankTransaction['id'];
  /** `null` returns the transaction to automatic recognition. */
  override: OwnTransferOverride | null;
  /** The other leg before the change, so the outcome can say what happened to it. */
  counterpartId?: BankTransaction['id'] | null;
};

const UNMARKED_ONE_SIDE = 'Unmarked. It counts toward income or spending again.';

export const useUpdateBankTransactionOwnTransfer = () => {
  const queryClient = useQueryClient();
  const {mutateAsync, isPending} = useMutation<
    BankTransaction,
    HttpError,
    UpdateBankTransactionOwnTransferInput
  >({
    mutationFn: async ({id, override}) => {
      return await api.patch<BankTransaction>(
        `/bank-transactions/${id}/own-transfer`,
        JSON.stringify({override}),
      );
    },
    onSuccess: async (updatedTransaction, {id}) => {
      queryClient.setQueryData(bankQueryKeys.transaction(id), updatedTransaction);
      // A change can pair, unpair or re-pair other legs, so refetch everything else.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: bankQueryKeys.transactionRoot,
          predicate: ({queryKey}) => queryKey[1] !== id,
        }),
        queryClient.invalidateQueries({queryKey: bankQueryKeys.transactionsRoot}),
        queryClient.invalidateQueries({queryKey: bankQueryKeys.connectionTransactionsRoot}),
      ]);
    },
  });

  /** Unmarking applies to one leg only, so say whether the other leg still counts as an own transfer. */
  const describeUnmarked = async (counterpartId: BankTransaction['id'] | null | undefined) => {
    if (!counterpartId) return UNMARKED_ONE_SIDE;
    try {
      const counterpart = await queryClient.fetchQuery({
        ...bankTransactionQueryOptions(counterpartId),
        staleTime: 0,
      });
      return counterpart.ownTransfer
        ? 'Unmarked. The other side is still an own transfer; unmark it too if neither is.'
        : 'Unmarked. Both sides count toward income or spending again.';
    } catch {
      return UNMARKED_ONE_SIDE;
    }
  };

  const updateBankTransactionOwnTransfer = (input: UpdateBankTransactionOwnTransferInput) =>
    toast.promise(mutateAsync(input), {
      loading: 'Saving...',
      success: () => {
        if (input.override === 'MARKED') {
          return 'Marked as own transfer. It no longer counts toward income or spending.';
        }
        if (input.override === 'UNMARKED') return describeUnmarked(input.counterpartId);
        return 'Back to automatic recognition.';
      },
      error: 'Own-transfer setting could not be saved. Please try again.',
    });

  return {updateBankTransactionOwnTransfer, isPending};
};
