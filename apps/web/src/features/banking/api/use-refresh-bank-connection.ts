import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {HttpError, SessionChangedError, api, isAuthError} from '@/utils/api';

import type {BankSyncRun} from '../types/bank-sync-run';
import {getBankRefreshFeedback} from '../utils/bank-refresh-feedback';
import {invalidateBankDerivedData} from './invalidate-bank-derived-data';
import {bankQueryKeys} from './query-keys';

export function useRefreshBankConnection() {
  const queryClient = useQueryClient();
  const {mutateAsync, ...state} = useMutation({
    mutationFn: (connectionId: string) =>
      api.post<BankSyncRun>(`/bank-connections/${connectionId}/refresh`),
    onSuccess: async (result) => {
      if (result.status !== 'SUCCEEDED') {
        const feedback = getBankRefreshFeedback(result);
        toast.error(feedback.title, {description: result.errorMessage || feedback.message});
      }
      await invalidateBankDerivedData(queryClient);
    },
    onError: (error) => {
      if (isAuthError(error) || error instanceof SessionChangedError) return;
      if (error instanceof HttpError && (error.status === 0 || error.status === 429)) return;
      toast.error('Bank refresh failed', {description: error.message});
    },
    onSettled: () =>
      queryClient.invalidateQueries({queryKey: bankQueryKeys.connections, exact: true}),
  });

  return {refreshBankConnection: mutateAsync, ...state};
}
