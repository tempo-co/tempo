import {useMutation, useQueryClient} from '@tanstack/react-query';

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
      queryClient.setQueryData(
        ['bank-statements', pagination, bankAccountId],
        (prevData: {bankStatements: BankStatement[]; total: number}) => ({
          bankStatements: prevData?.bankStatements.filter((bs) => bs.id !== bankStatementId) ?? [],
          total: (prevData?.total ?? 1) - 1,
        }),
      );
    },
    retry: false,
  });

  return {mutateAsync, isPending};
};
