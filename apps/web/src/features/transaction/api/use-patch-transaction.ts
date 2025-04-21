import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {Transaction} from '@/types/transaction';
import {HttpError, api} from '@/utils/api';

type PatchTransactionVariables = {
  id: Transaction['id'];
  patchDto: Pick<Transaction, 'category'>;
};

export const usePatchTransaction = () => {
  const queryClient = useQueryClient();

  const {mutateAsync} = useMutation<Transaction, HttpError, PatchTransactionVariables>({
    mutationFn: async ({id, patchDto}) => {
      return await api.patch<Transaction>(`/transactions/${id}`, JSON.stringify(patchDto));
    },
    onSuccess: (updatedTransaction) => {
      queryClient.setQueryData(['transaction', updatedTransaction.id], updatedTransaction);
    },
  });

  const patchTransaction = (variables: PatchTransactionVariables) => {
    return toast.promise(mutateAsync(variables), {
      loading: 'Updating transaction...',
      success: 'Transaction updated.',
      error: (error: HttpError) => error.message || 'Error updating transaction',
    });
  };

  return {patchTransaction};
};
