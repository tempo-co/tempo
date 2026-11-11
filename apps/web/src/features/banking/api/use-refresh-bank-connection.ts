import {useMutation, useMutationState} from '@tanstack/react-query';

import {api} from '@/utils/api';

import type {BankSyncRun} from '../types/bank-sync-run';

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
 * Refreshes one connection. Opening the app starts it, not the owner, so its outcome stays quiet:
 * a failed or partial run retries on its own, and one that keeps failing shows on its bank card.
 * Only the `api` wrapper's shared toasts (offline, session, rate limit) can appear. Re-reading the
 * saved connections and bank-derived data is left to the caller, so a run over several banks
 * reloads them once.
 */
export function useRefreshBankConnection() {
  const {mutateAsync, ...state} = useMutation({
    mutationKey: BANK_REFRESH_KEY,
    mutationFn: ({connectionId, signal}: RefreshRequest) =>
      // 204 (null): the bank synchronized moments ago, so the API skipped it and nothing changed.
      api.post<BankSyncRun | null>(`/bank-connections/${connectionId}/refresh`, undefined, {
        signal,
      }),
  });

  return {refreshBankConnection: mutateAsync, ...state};
}
