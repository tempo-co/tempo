import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {HttpError, api} from '@/utils/api';

import {
  BankTransaction,
  BankTransactionCategory,
  BankTransactionsResponse,
} from '../types/bank-transaction';

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
      queryClient.setQueryData(['bank-transaction', id], updatedTransaction);
      queryClient.setQueriesData<BankTransactionsResponse>(
        {queryKey: ['bank-transactions']},
        (current) => {
          if (
            !current ||
            !current.transactions.some(
              ({id: transactionId}) => transactionId === updatedTransaction.id,
            )
          ) {
            return current;
          }
          return {
            ...current,
            transactions: current.transactions.map((transaction) =>
              transaction.id === updatedTransaction.id ? updatedTransaction : transaction,
            ),
          };
        },
      );
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
