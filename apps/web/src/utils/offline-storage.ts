import {createAsyncStoragePersister} from '@tanstack/query-async-storage-persister';
import {type QueryClient, type QueryKey, onlineManager} from '@tanstack/react-query';
import {
  type PersistQueryClientOptions,
  type PersistRetryer,
  type PersistedClient,
} from '@tanstack/react-query-persist-client';
import {toast} from 'sonner';

import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {bankQueryKeys} from '@/features/banking/api/query-keys';
import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import type {Account} from '@/types/account';

const CACHE_KEY = 'tempo-offline-cache';
export const OFFLINE_MAX_AGE = 24 * 60 * 60 * 1000;
/** Room, in JSON characters, for loaded data that is neither kept nor on screen. */
const RECENT_DATA_BUDGET = 2 * 1024 * 1024;
/**
 * Data saved for offline use, by query key root. `kept` data is always saved. `recent` data shares
 * one budget, newest first, unless it is on screen. Data not listed here is never saved.
 */
const savedQueryRoots = new Map<unknown, 'kept' | 'recent'>([
  [CURRENT_ACCOUNT_KEY[0], 'kept'],
  [bankQueryKeys.connections[0], 'kept'],
  [bankQueryKeys.connectionTransactionsRoot[0], 'recent'],
  [bankQueryKeys.transactionsRoot[0], 'recent'],
  [bankQueryKeys.transactionRoot[0], 'recent'],
  [dashboardQueryKeys.root[0], 'recent'],
]);
const SAVE_FAILED_TOAST = 'offline-save-failed';
let saveFailed = false;

type SavedQuery = PersistedClient['clientState']['queries'][number];

export const isAccountQuery = ({queryKey}: {queryKey: QueryKey}) =>
  queryKey[0] === CURRENT_ACCOUNT_KEY[0];

function clearOfflineCache() {
  if (saveFailed) toast.dismiss(SAVE_FAILED_TOAST);
  saveFailed = false;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* Storage may be disabled. */
  }
}

/** Removes the account and all loaded data from this tab and from storage. */
export function dropSavedData(queryClient: QueryClient) {
  queryClient.removeQueries({predicate: (query) => !isAccountQuery(query)});
  queryClient.setQueryData(CURRENT_ACCOUNT_KEY, null);
  clearOfflineCache();
}

export function createOfflinePersistence(
  queryClient: QueryClient,
  signOut: () => void,
): Omit<PersistQueryClientOptions, 'queryClient'> {
  const cache = queryClient.getQueryCache();
  const isShown = ({queryHash}: SavedQuery) => !!cache.get(queryHash)?.getObserversCount();
  const isKept = (query: SavedQuery) =>
    savedQueryRoots.get(query.queryKey[0]) === 'kept' || isShown(query);

  let hasShownRecent = false;
  /** Saves kept data and the newest other data that fits the budget. */
  const withinBudget = (queries: SavedQuery[]) => {
    // While the app starts, the view shown before a reload is not on screen yet, so the saved data
    // is kept as it was until a view is.
    hasShownRecent ||= queries.some(
      (query) => savedQueryRoots.get(query.queryKey[0]) === 'recent' && isShown(query),
    );
    if (!hasShownRecent) return queries;
    const recent = queries
      .filter((query) => !isKept(query))
      .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
    let room = RECENT_DATA_BUDGET;
    // Once the budget is used up, everything older is dropped too, even if it is small.
    const dropped = new Set(recent.filter((query) => (room -= JSON.stringify(query).length) < 0));
    return queries.filter((query) => !dropped.has(query));
  };

  // The browser refused the save, for example because storage is full: drop the oldest data that
  // does not have to be kept. If only kept data is left, the previous save stays and the user is told.
  const retry: PersistRetryer = ({persistedClient}) => {
    const queries = withinBudget(persistedClient.clientState.queries);
    const oldest = queries
      .filter((query) => !isKept(query))
      .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt)[0];
    if (!oldest) {
      if (!saveFailed)
        toast.warning('Tempo cannot save data for offline use', {
          id: SAVE_FAILED_TOAST,
          description: 'The browser refused to store it. What you open now may not work offline.',
          duration: Infinity,
        });
      saveFailed = true;
      return undefined;
    }
    return {
      ...persistedClient,
      clientState: {
        ...persistedClient.clientState,
        queries: queries.filter((query) => query !== oldest),
      },
    };
  };

  window.addEventListener('storage', (event) => {
    // Another tab logged out or lost its session.
    if (event.key !== CACHE_KEY || event.newValue !== null) return;
    if (queryClient.getQueryData(CURRENT_ACCOUNT_KEY)) signOut();
    // A signed-out tab stays where it is, but a session check started before the logout must not
    // sign it in: ask again.
    else if (queryClient.isFetching({queryKey: CURRENT_ACCOUNT_KEY}))
      void queryClient
        .cancelQueries({queryKey: CURRENT_ACCOUNT_KEY})
        .then(() => queryClient.refetchQueries({queryKey: CURRENT_ACCOUNT_KEY}));
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
    retry,
    deserialize: (value) => {
      const saved = JSON.parse(value) as PersistedClient;
      saved.clientState.queries = saved.clientState.queries.filter(
        (query) => Date.now() - query.state.dataUpdatedAt < OFFLINE_MAX_AGE,
      );
      if (!saved.clientState.queries.some(isAccountQuery)) {
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
        const savedAccount = saved.clientState.queries.find(isAccountQuery)?.state.data as
          Account | undefined;
        const account = queryClient.getQueryData<Account | null>(CURRENT_ACCOUNT_KEY);
        if (!account || account.id !== savedAccount?.id) return;
        localStorage.setItem(key, value);
        if (saveFailed) toast.dismiss(SAVE_FAILED_TOAST);
        saveFailed = false;
      },
    },
    serialize: (client) =>
      JSON.stringify({
        ...client,
        clientState: {
          ...client.clientState,
          // Keep the last successful data, not the subsequent reconnect error.
          queries: withinBudget(
            client.clientState.queries.map((query) => ({
              ...query,
              state: {...query.state, status: 'success', error: null, fetchFailureReason: null},
            })),
          ),
        },
      }),
  });
  return {
    persister,
    maxAge: OFFLINE_MAX_AGE,
    buster: 'tempo-offline-v1',
    dehydrateOptions: {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query) =>
        savedQueryRoots.has(query.queryKey[0]) &&
        query.state.data != null &&
        Date.now() - query.state.dataUpdatedAt < OFFLINE_MAX_AGE,
    },
  };
}
