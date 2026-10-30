import {useMutation, useQueryClient} from '@tanstack/react-query';
import {BANK_TRANSACTION_UNCATEGORIZED, BankTransactionCategory} from '@tempo/contracts';
import {toast} from 'sonner';

import {HttpError, api, wasToasted} from '@/utils/api';

import {
  BankTransaction,
  BankTransactionFilterParams,
  BankTransactionsResponse,
} from '../types/bank-transaction';
import {invalidateBankDerivedData} from './invalidate-bank-derived-data';
import {bankQueryKeys} from './query-keys';

type UpdateBankTransactionCategoryInput = {
  id: BankTransaction['id'];
  category: BankTransactionCategory;
  /** The owner's other rows from the preview that change too; omitted changes only this row. */
  applyToTransactionIds?: BankTransaction['id'][];
};

export const useUpdateBankTransactionCategory = () => {
  const queryClient = useQueryClient();
  const {mutateAsync, isPending} = useMutation<
    BankTransaction,
    HttpError,
    UpdateBankTransactionCategoryInput
  >({
    mutationFn: async ({id, category, applyToTransactionIds}) => {
      return await api.patch<BankTransaction>(`/bank-transactions/${id}/category`, {
        category,
        applyToTransactionIds,
      });
    },
    onSuccess: async (updatedTransaction, {id}) => {
      queryClient.setQueryData(bankQueryKeys.transaction(id), updatedTransaction);
      for (const [queryKey, current] of queryClient.getQueriesData<BankTransactionsResponse>({
        queryKey: bankQueryKeys.transactionsRoot,
      })) {
        if (
          !current ||
          !current.transactions.some(
            ({id: transactionId}) => transactionId === updatedTransaction.id,
          )
        ) {
          continue;
        }

        const filters = queryKey[2] as BankTransactionFilterParams | undefined;
        if (matchesBankTransactionFilters(updatedTransaction, filters)) {
          queryClient.setQueryData<BankTransactionsResponse>(queryKey, {
            ...current,
            transactions: current.transactions.map((transaction) =>
              transaction.id === updatedTransaction.id ? updatedTransaction : transaction,
            ),
          });
        } else {
          queryClient.setQueryData<BankTransactionsResponse>(queryKey, {
            ...current,
            transactions: current.transactions.filter(
              ({id: transactionId}) => transactionId !== updatedTransaction.id,
            ),
            total: Math.max(0, current.total - 1),
          });
        }
      }
      // The API also changes the rows the owner selected from the same merchant, so refetch every
      // list and every other cached detail, not just the corrected row.
      await invalidateBankDerivedData(queryClient, {exceptTransactionId: id});
    },
  });

  const updateBankTransactionCategory = async (input: UpdateBankTransactionCategoryInput) => {
    // The select and its status line show progress and the saved category; only failures toast.
    try {
      return await mutateAsync(input);
    } catch (error) {
      if (!wasToasted(error)) {
        toast.error('Transaction category could not be saved. Please try again.');
      }
      throw error;
    }
  };

  return {updateBankTransactionCategory, isPending};
};

function matchesBankTransactionFilters(
  transaction: BankTransaction,
  filters: BankTransactionFilterParams | undefined,
) {
  const categories = filters?.categories;
  if (
    categories &&
    categories.length > 0 &&
    !categories.some((category) => {
      if (category === BANK_TRANSACTION_UNCATEGORIZED) {
        return transaction.category === null;
      }
      return transaction.category === category;
    })
  ) {
    return false;
  }

  const categorySources = filters?.categorySources;
  return (
    !categorySources ||
    categorySources.length === 0 ||
    categorySources.includes(transaction.categorySource as (typeof categorySources)[number])
  );
}
