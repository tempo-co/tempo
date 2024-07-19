import {useMutation} from '@tanstack/react-query';

import {Account} from '@/types/account';
import {BankStatement} from '@/types/bank-statement';
import {api} from '@/utils/api';

export const useUploadBankStatement = (accountId: Account['id']) => {
  const {
    data: statement,
    mutate,
    isPending,
    isError,
    isSuccess,
  } = useMutation<BankStatement, Error, File>({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await api.post(`/bank-statements/upload/${accountId}`, formData, {
        headers: {},
      });
      return response.json();
    },
  });

  return {statement, mutate, isPending, isError, isSuccess};
};
