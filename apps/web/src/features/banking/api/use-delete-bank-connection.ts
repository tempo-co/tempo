import {useMutation, useQueryClient} from '@tanstack/react-query';

import {HttpError, api} from '@/utils/api';

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
      await queryClient.invalidateQueries({queryKey: ['bank-connections']});
    },
    retry: false,
  });

  const deleteBankConnection = (connectionId: string, confirmation?: string) =>
    deleteMutation({connectionId, confirmation});

  return {deleteBankConnection, isPending};
};
