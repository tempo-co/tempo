import {useMutation, useQueryClient} from '@tanstack/react-query';

import {Account} from '@/types/account';
import {BankStatement} from '@/types/bank-statement';
import {api} from '@/utils/api';

export const useUploadBankStatement = (accountId: Account['id']) => {
  const queryClient = useQueryClient();

  const {
    data: bankStatement,
    mutate,
    isPending,
    isError,
    isSuccess,
  } = useMutation<BankStatement, Error, File>({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post(`/accounts/${accountId}/bank-statements/upload`, formData, {
        headers: {},
      });
      const bankStatement = (await response.json()) as BankStatement;

      queryClient.setQueryData(
        ['bank-statements', accountId],
        (prevBankStatements: BankStatement[]) => [...prevBankStatements, bankStatement],
      );
      return bankStatement;
    },
    retry: false,
  });

  return {bankStatement, mutate, isPending, isError, isSuccess};
};
