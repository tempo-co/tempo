import {useMutation, useQueryClient} from '@tanstack/react-query';
import {PaginationState} from '@tanstack/react-table';
import {toast} from 'sonner';

import {Account} from '@/types/account';
import {BankStatement} from '@/types/bank-statement';
import {api} from '@/utils/api';

export const useDeleteBankStatement = (
  accountId: Account['id'],
  bankStatementId: BankStatement['id'],
  pagination: PaginationState,
) => {
  const queryClient = useQueryClient();

  const {mutateAsync, isPending, isError} = useMutation({
    mutationFn: async () => {
      await api.delete(`/accounts/${accountId}/bank-statements/${bankStatementId}`);
      queryClient.setQueryData(
        ['bank-statements', pagination, accountId],
        (prevData: {bankStatements: BankStatement[]; total: number}) => ({
          bankStatements: prevData?.bankStatements.filter((bs) => bs.id !== bankStatementId) ?? [],
          total: (prevData?.total ?? 1) - 1,
        }),
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
