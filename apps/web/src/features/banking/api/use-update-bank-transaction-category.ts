import {useMutation, useQueryClient} from '@tanstack/react-query';
import {
  BANK_TRANSACTION_UNCATEGORIZED,
  BankTransaction,
  BankTransactionCategory,
  BankTransactionsResponse,
} from '@tempo/contracts';
import {toast} from 'sonner';

import {HttpError, api, wasToasted} from '@/utils/api';

import {BankTransactionFilterParams} from '../types/bank-transaction';
import {invalidateBankDerivedData} from './invalidate-bank-derived-data';
import {type CachedTransactionList, listedPages, mapListedPages} from './listed-transactions';
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
      for (const [queryKey, current] of queryClient.getQueriesData<CachedTransactionList>({
        queryKey: bankQueryKeys.transactionsRoot,
      })) {
        const isListed = (page: BankTransactionsResponse) =>
          page.transactions.some(({id: transactionId}) => transactionId === updatedTransaction.id);
        if (!current || !listedPages(current).some(isListed)) continue;

        const filters = queryKey[2] as BankTransactionFilterParams | undefined;
        const stays = matchesBankTransactionFilters(updatedTransaction, filters);
        queryClient.setQueryData<CachedTransactionList>(
          queryKey,
          mapListedPages(current, (page) =>
            stays
              ? {
                  ...page,
                  transactions: page.transactions.map((transaction) =>
                    transaction.id === updatedTransaction.id ? updatedTransaction : transaction,
                  ),
                }
              : {
                  ...page,
                  transactions: page.transactions.filter(
                    ({id: transactionId}) => transactionId !== updatedTransaction.id,
                  ),
                  // Every page carries the list's total.
                  total: Math.max(0, page.total - 1),
                },
          ),
        );
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
