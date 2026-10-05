import {useMutation, useQueryClient} from '@tanstack/react-query';

import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {HttpError, api} from '@/utils/api';

import {bankQueryKeys} from './query-keys';

export const useDeleteBankConnection = () => {
  const queryClient = useQueryClient();

  const {mutateAsync: deleteMutation, isPending} = useMutation<
    void,
    HttpError,
    {connectionId: string; confirmation?: string}
  >({
    mutationFn: async ({connectionId, confirmation}) => {
      await api.delete<void>(`/bank-connections/${connectionId}`, {
        body: confirmation ? JSON.stringify({confirmation}) : undefined,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({queryKey: bankQueryKeys.connections}),
        queryClient.invalidateQueries({queryKey: dashboardQueryKeys.root}),
      ]);
    },
  });

  const deleteBankConnection = (connectionId: string, confirmation?: string) =>
    deleteMutation({connectionId, confirmation});

  return {deleteBankConnection, isPending};
};
