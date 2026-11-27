import {useMutation, useQueryClient} from '@tanstack/react-query';
import type {
  BankTransaction,
  BankTransactionBulkLeftOutOfTotalsResult,
  BankTransactionBulkLeftOutOfTotalsUpdate,
  BankTransactionLeftOutOfTotalsUpdate,
} from '@tempo/contracts';
import {toast} from 'sonner';

import {HttpError, api, wasToasted} from '@/utils/api';

import {invalidateBankDerivedData} from './invalidate-bank-derived-data';
import {bankQueryKeys} from './query-keys';

/**
 * Leaves one row out of every total, or counts it again. The switch shows progress and the saved state, so only a
 * failure the `api` wrapper did not report toasts.
 */
export const useUpdateLeftOutOfTotals = () => {
  const queryClient = useQueryClient();
  const {mutate, isPending, variables} = useMutation<
    BankTransaction,
    HttpError,
    BankTransactionLeftOutOfTotalsUpdate & {id: BankTransaction['id']}
  >({
    mutationFn: ({id, leftOutOfTotals}) =>
      api.patch<BankTransaction>(`/bank-transactions/${id}/left-out-of-totals`, {
        leftOutOfTotals,
      } satisfies BankTransactionLeftOutOfTotalsUpdate),
    onSuccess: async (updated, {id}) => {
      queryClient.setQueryData(bankQueryKeys.transaction(id), updated);
      // Every list, total and recurring series reads the flag, so all of them are read again.
      await invalidateBankDerivedData(queryClient, {exceptTransactionId: id});
    },
    onError: (error) => {
      if (!wasToasted(error)) toast.error("Couldn't save whether it counts in totals. Try again.");
    },
  });
  return {updateLeftOutOfTotals: mutate, isPending, pendingValue: variables?.leftOutOfTotals};
};

/** Leaves the selected rows out of every total, or counts them again, in one write. */
export const useUpdateBulkLeftOutOfTotals = () => {
  const queryClient = useQueryClient();
  const {mutateAsync, isPending} = useMutation<
    BankTransactionBulkLeftOutOfTotalsResult,
    HttpError,
    BankTransactionBulkLeftOutOfTotalsUpdate
  >({
    mutationFn: (body) =>
      api.patch<BankTransactionBulkLeftOutOfTotalsResult>(
        '/bank-transactions/bulk-left-out-of-totals',
        body,
      ),
    onSuccess: () => invalidateBankDerivedData(queryClient),
  });
  return {updateBulkLeftOutOfTotals: mutateAsync, isPending};
};
