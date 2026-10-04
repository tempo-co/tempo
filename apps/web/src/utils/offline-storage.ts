import {createAsyncStoragePersister} from '@tanstack/query-async-storage-persister';
import {type QueryClient, onlineManager} from '@tanstack/react-query';
import {type PersistedClient, removeOldestQuery} from '@tanstack/react-query-persist-client';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import type {Account} from '@/types/account';
import {endSession} from '@/utils/api';

const CACHE_KEY = 'tempo-offline-cache';
export const OFFLINE_MAX_AGE = 24 * 60 * 60 * 1000;
const savedQueryRoots = new Set([
  CURRENT_ACCOUNT_KEY[0],
  'bank-connections',
  'bank-connection-transactions',
  'bank-transactions',
  'bank-transaction',
]);

export function clearOfflineCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* Storage may be disabled. */
  }
}

/** Removes the account and all loaded data from this tab and from storage. */
export function dropSavedData(queryClient: QueryClient) {
  queryClient.removeQueries({predicate: ({queryKey}) => queryKey[0] !== CURRENT_ACCOUNT_KEY[0]});
  queryClient.setQueryData(CURRENT_ACCOUNT_KEY, null);
  clearOfflineCache();
}

export function createOfflinePersistence(queryClient: QueryClient) {
  window.addEventListener('storage', (event) => {
    // Another tab logged out or lost its session; replies to this tab's open requests are discarded.
    if (event.key === CACHE_KEY && event.newValue === null) {
      endSession();
      dropSavedData(queryClient);
    }
  });
  // An open tab must not keep showing saved data past the limit, even with no new requests.
  window.setInterval(() => {
    const account = queryClient.getQueryState(CURRENT_ACCOUNT_KEY);
    if (account?.data && Date.now() - account.dataUpdatedAt >= OFFLINE_MAX_AGE) {
      if (onlineManager.isOnline())
        void queryClient.invalidateQueries({queryKey: CURRENT_ACCOUNT_KEY});
      else dropSavedData(queryClient);
    }
  }, 60_000);
  const persister = createAsyncStoragePersister({
    key: CACHE_KEY,
    throttleTime: 1000,
    retry: removeOldestQuery,
    deserialize: (value) => {
      const saved = JSON.parse(value) as PersistedClient;
      saved.clientState.queries = saved.clientState.queries.filter(
        (query) => Date.now() - query.state.dataUpdatedAt < OFFLINE_MAX_AGE,
      );
      if (
        !saved.clientState.queries.some((query) => query.queryKey[0] === CURRENT_ACCOUNT_KEY[0])
      ) {
        clearOfflineCache();
        saved.clientState.queries = [];
      }
      return saved;
    },
    storage: {
      getItem: (key) => {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      removeItem: clearOfflineCache,
      setItem: (key, value) => {
        // A throttled save from the previous login must not resurrect private data after logout.
        // Skip it without removing storage: another tab may still be signed in and own that data.
        const saved = JSON.parse(value) as PersistedClient;
        const savedAccount = saved.clientState.queries.find(
          (query) => query.queryKey[0] === CURRENT_ACCOUNT_KEY[0],
        )?.state.data as Account | undefined;
        const account = queryClient.getQueryData<Account | null>(CURRENT_ACCOUNT_KEY);
        if (!account || account.id !== savedAccount?.id) return;
        localStorage.setItem(key, value);
      },
    },
    serialize: (client) =>
      JSON.stringify({
        ...client,
        clientState: {
          ...client.clientState,
          // Keep the last successful data, not the subsequent reconnect error.
          queries: client.clientState.queries.map((query) => ({
            ...query,
            state: {...query.state, status: 'success', error: null, fetchFailureReason: null},
          })),
        },
      }),
  });
  return {
    persister,
    maxAge: OFFLINE_MAX_AGE,
    buster: 'tempo-offline-v1',
    dehydrateOptions: {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query: {
        queryKey: readonly unknown[];
        state: {data: unknown; dataUpdatedAt: number};
      }) =>
        savedQueryRoots.has(String(query.queryKey[0])) &&
        query.state.data != null &&
        Date.now() - query.state.dataUpdatedAt < OFFLINE_MAX_AGE,
    },
  };
}
