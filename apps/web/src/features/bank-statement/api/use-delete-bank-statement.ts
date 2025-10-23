import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {BankAccount} from '@/types/bank-account';
import {BankStatement} from '@/types/bank-statement';
import {PaginationParams} from '@/types/pagination';
import {api} from '@/utils/api';

export const useDeleteBankStatement = (
  bankAccountId: BankAccount['id'],
  bankStatementId: BankStatement['id'],
  pagination: PaginationParams,
) => {
  const queryClient = useQueryClient();

  const {mutateAsync, isPending} = useMutation({
    mutationFn: async () => {
      await api.delete(`/bank-accounts/${bankAccountId}/bank-statements/${bankStatementId}`);
    },
    onSuccess: async () => {
      toast.success('Bank statement deleted successfully.');
      await queryClient.invalidateQueries({
        queryKey: ['bank-statements', pagination, bankAccountId],
      });
    },
    onError: () => {
      toast.error('Failed to delete bank statement.');
    },
    retry: false,
  });

  return {mutateAsync, isPending};
};
