import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {Account} from '@/types/account';
import {BankStatement} from '@/types/bank-statement';
import {api} from '@/utils/api';

export const useDeleteBankStatement = (
  accountId: Account['id'],
  bankStatementId: BankStatement['id'],
) => {
  const queryClient = useQueryClient();

  const {mutateAsync, isPending, isError} = useMutation({
    mutationFn: async () => {
      await api.delete(`/accounts/${accountId}/bank-statements/${bankStatementId}`);

      queryClient.setQueryData(
        ['bank-statements', accountId],
        (prevBankStatements: BankStatement[]) =>
          prevBankStatements.filter((bs) => bs.id !== bankStatementId),
      );
    },
    onError: () => {
      toast.error('There was a problem with your request.', {
        description: 'Bank statement could not be deleted. Please try again.',
      });
    },
    retry: false,
  });

  return {mutateAsync, isPending, isError};
};
