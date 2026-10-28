import {onlineManager, useQueryClient} from '@tanstack/react-query';
import {useEffect} from 'react';

import {CURRENT_ACCOUNT_KEY, PAGE_LOADED_AT} from '@/hooks/use-current-account';
import type {Account} from '@/types/account';
import {getSessionSignal} from '@/utils/api';
import {isAccountQuery} from '@/utils/offline-storage';

import {isReauthorizationRequired, isSyncInProgress} from '../utils/bank-sync-status';
import {DELETE_BANK_CONNECTION_KEY} from './use-delete-bank-connection';
import {bankConnectionsQueryOptions} from './use-get-all-bank-connections';
import {useRefreshBankConnection} from './use-refresh-bank-connection';

/** Owns foreground work once per opening, not per route, query render, focus or reconnect. */
export function useAppOpenBankRefresh() {
  const queryClient = useQueryClient();
  const {refreshBankConnection} = useRefreshBankConnection();
  useEffect(() => {
    let visible = document.visibilityState === 'visible';
    let openingPending = visible && onlineManager.isOnline();
    let inFlight = false;
    let disposed = false;
    let controller: AbortController | undefined;
    let activeAccountId: string | undefined;
    let previousAccountId = queryClient.getQueryData<Account | null>(CURRENT_ACCOUNT_KEY)?.id;
    const liveAccount = () => {
      const state = queryClient.getQueryState<Account | null>(CURRENT_ACCOUNT_KEY);
      return state?.data?.isEmailVerified && !state.error && state.dataUpdatedAt >= PAGE_LOADED_AT
        ? state.data
        : undefined;
    };
    const refresh = async () => {
      const account = liveAccount();
      if (
        disposed ||
        !openingPending ||
        !visible ||
        !onlineManager.isOnline() ||
        !account ||
        inFlight
      )
        return;
      openingPending = false;
      inFlight = true;
      activeAccountId = account.id;
      const run = new AbortController();
      const signal = AbortSignal.any([run.signal, getSessionSignal()]);
      controller = run;
      try {
        // Always read the saved connection list for this opening, including current sync locks.
        const connections = await queryClient.fetchQuery(bankConnectionsQueryOptions);
        for (const {id} of connections) {
          if (
            signal.aborted ||
            !visible ||
            !onlineManager.isOnline() ||
            liveAccount()?.id !== account.id
          )
            return;
          const connection = queryClient
            .getQueryData(bankConnectionsQueryOptions.queryKey)
            ?.find((connection) => connection.id === id);
          if (
            !connection ||
            connection.status !== 'AUTHORIZED' ||
            isReauthorizationRequired(connection) ||
            isSyncInProgress(connection)
          )
            continue;
          if (
            queryClient.isMutating({
              mutationKey: DELETE_BANK_CONNECTION_KEY,
              predicate: ({state}) =>
                (state.variables as {connectionId?: string} | undefined)?.connectionId ===
                connection.id,
            })
          )
            continue;
          await refreshBankConnection({connectionId: connection.id, signal}).catch(() => undefined);
        }
      } finally {
        inFlight = false;
        activeAccountId = undefined;
        // Only in-flight work is cancellable; aborting a finished run would hide its result.
        if (controller === run) controller = undefined;
        // Coalesce visibility transitions while cancellation is settling into one fresh opening.
        void refresh().catch(() => undefined);
      }
    };
    const onVisibility = () => {
      const nextVisible = document.visibilityState === 'visible';
      if (nextVisible === visible) return;
      visible = nextVisible;
      openingPending = visible && onlineManager.isOnline();
      if (!visible) controller?.abort();
      else void refresh().catch(() => undefined);
    };
    const unsubscribeAccount = queryClient.getQueryCache().subscribe(({query}) => {
      if (!isAccountQuery(query)) return;
      const accountId = queryClient.getQueryData<Account | null>(CURRENT_ACCOUNT_KEY)?.id;
      if (accountId !== previousAccountId) {
        previousAccountId = accountId;
        openingPending = visible && onlineManager.isOnline();
      }
      if (activeAccountId && liveAccount()?.id !== activeAccountId) controller?.abort();
      void refresh().catch(() => undefined);
    });
    const unsubscribeOnline = onlineManager.subscribe((online) => {
      if (!online) {
        openingPending = false;
        controller?.abort();
      }
    });
    window.addEventListener('visibilitychange', onVisibility);
    void refresh().catch(() => undefined);
    return () => {
      disposed = true;
      controller?.abort();
      unsubscribeAccount();
      unsubscribeOnline();
      window.removeEventListener('visibilitychange', onVisibility);
    };
  }, [queryClient, refreshBankConnection]);
}
