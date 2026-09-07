import {useMutation, useQueryClient} from '@tanstack/react-query';

import {BankSyncRun} from '@/features/banking/types/bank-connection';
import {HttpError, api} from '@/utils/api';

export const useSyncBankConnection = () => {
  const queryClient = useQueryClient();
  const {mutateAsync: syncBankConnection, isPending} = useMutation<BankSyncRun, HttpError, string>({
    mutationFn: async (connectionId) => {
      return await api.post<BankSyncRun>(`/bank-connections/${connectionId}/sync`);
    },
    onSuccess: async (_, connectionId) => {
      await Promise.all([
        queryClient.invalidateQueries({queryKey: ['bank-connections']}),
        queryClient.invalidateQueries({queryKey: ['bank-connection-transactions', connectionId]}),
      ]);
    },
    retry: false,
  });

  return {syncBankConnection, isPending};
};
