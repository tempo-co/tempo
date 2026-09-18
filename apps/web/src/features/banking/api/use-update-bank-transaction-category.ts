import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {HttpError, api} from '@/utils/api';

import {
  BANK_TRANSACTION_UNCATEGORIZED,
  BankTransaction,
  BankTransactionCategory,
  BankTransactionFilterParams,
  BankTransactionsResponse,
} from '../types/bank-transaction';
import {bankQueryKeys} from './query-keys';

type UpdateBankTransactionCategoryInput = {
  id: BankTransaction['id'];
  category: BankTransactionCategory;
};

export const useUpdateBankTransactionCategory = () => {
  const queryClient = useQueryClient();
  const {mutateAsync, isPending} = useMutation<
    BankTransaction,
    HttpError,
    UpdateBankTransactionCategoryInput
  >({
    mutationFn: async ({id, category}) => {
      return await api.patch<BankTransaction>(
        `/bank-transactions/${id}/category`,
        JSON.stringify({category}),
      );
    },
    onSuccess: (updatedTransaction, {id}) => {
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
    },
    retry: false,
  });

  const updateBankTransactionCategory = (input: UpdateBankTransactionCategoryInput) =>
    toast.promise(mutateAsync(input), {
      loading: 'Saving category...',
      success: 'Transaction category saved.',
      error: 'Transaction category could not be saved. Please try again.',
    });

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
