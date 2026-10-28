import {useMutation, useMutationState, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {HttpError, SessionChangedError, api, isAuthError} from '@/utils/api';

import type {BankSyncRun} from '../types/bank-sync-run';
import {getBankRefreshToast} from '../utils/bank-refresh-feedback';
import {invalidateBankDerivedData} from './invalidate-bank-derived-data';
import {bankQueryKeys} from './query-keys';

const BANK_REFRESH_KEY = ['bank-refresh'];
type RefreshRequest = {connectionId: string; signal?: AbortSignal};

/** Observe the app-wide refresh without creating a mutation for each card. */
export function useBankConnectionRefreshState(connectionId: string) {
  const states = useMutationState({
    filters: {
      mutationKey: BANK_REFRESH_KEY,
      predicate: ({state}) =>
        (state.variables as RefreshRequest | undefined)?.connectionId === connectionId,
    },
    select: (mutation) => mutation.state,
  });
  const state = states.slice(-1)[0];
  // A cancelled refresh (hidden app, session change) is not shown as running.
  const cancelled = (state?.variables as RefreshRequest | undefined)?.signal?.aborted;
  return {isPending: !cancelled && state?.status === 'pending'};
}

export function useRefreshBankConnection() {
  const queryClient = useQueryClient();
  const {mutateAsync, ...state} = useMutation({
    mutationKey: BANK_REFRESH_KEY,
    mutationFn: ({connectionId, signal}: RefreshRequest) =>
      // 204 (null): the bank synchronized moments ago, so the API skipped it and nothing changed.
      api.post<BankSyncRun | null>(`/bank-connections/${connectionId}/refresh`, undefined, {
        signal,
      }),
    onSuccess: async (result, {signal}) => {
      if (signal?.aborted || !result) return;
      const feedback = getBankRefreshToast(result);
      if (feedback) toast.error(feedback.title, {description: feedback.description});
      await invalidateBankDerivedData(queryClient);
    },
    onError: (error, {signal}) => {
      if (signal?.aborted) return;
      if (isAuthError(error) || error instanceof SessionChangedError) return;
      if (error instanceof HttpError && (error.status === 0 || error.status === 429)) return;
      toast.error('Bank refresh failed', {description: error.message});
    },
    onSettled: (_result, _error, {signal}) =>
      signal?.aborted
        ? undefined
        : queryClient.invalidateQueries({queryKey: bankQueryKeys.connections, exact: true}),
  });

  return {refreshBankConnection: mutateAsync, ...state};
}
