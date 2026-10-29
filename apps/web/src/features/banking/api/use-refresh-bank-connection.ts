import {useMutation, useMutationState} from '@tanstack/react-query';
import {toast} from 'sonner';

import {HttpError, NetworkError, SessionChangedError, api, isAuthError} from '@/utils/api';

import type {BankSyncRun} from '../types/bank-sync-run';
import {getBankRefreshToast} from '../utils/bank-refresh-feedback';

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

/**
 * Refreshes one connection and reports its outcome. Re-reading the saved connections and
 * bank-derived data is left to the caller, so a run over several banks reloads them once.
 */
export function useRefreshBankConnection() {
  const {mutateAsync, ...state} = useMutation({
    mutationKey: BANK_REFRESH_KEY,
    mutationFn: ({connectionId, signal}: RefreshRequest) =>
      // 204 (null): the bank synchronized moments ago, so the API skipped it and nothing changed.
      api.post<BankSyncRun | null>(`/bank-connections/${connectionId}/refresh`, undefined, {
        signal,
      }),
    onSuccess: (result, {signal}) => {
      if (signal?.aborted || !result) return;
      const feedback = getBankRefreshToast(result);
      if (feedback) toast.error(feedback.title, {description: feedback.description});
    },
    onError: (error, {signal}) => {
      if (signal?.aborted) return;
      if (isAuthError(error) || error instanceof SessionChangedError) return;
      if (error instanceof NetworkError || (error instanceof HttpError && error.status === 429))
        return;
      toast.error('Bank refresh failed', {description: error.message});
    },
  });

  return {refreshBankConnection: mutateAsync, ...state};
}
