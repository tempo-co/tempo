import {
  MutationCache,
  type Query,
  QueryCache,
  QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import {CURRENT_ACCOUNT_KEY, PAGE_LOADED_AT} from '@/hooks/use-current-account';
import {Account} from '@/types/account';
import {
  EmailNotVerifiedError,
  HttpError,
  SessionChangedError,
  SessionExpiredError,
  changeSession,
} from '@/utils/api';
import {OFFLINE_MAX_AGE, dropSavedData, isAccountQuery} from '@/utils/offline-storage';

import {router} from './router';

/**
 * Switches this tab to another session. Replies to requests started before the switch are
 * discarded, so they cannot restore the previous account or sign out the next one.
 */
function changeAccount(account: Account | null) {
  changeSession();
  void queryClient.cancelQueries();
  dropSavedData(queryClient);
  if (account) queryClient.setQueryData(CURRENT_ACCOUNT_KEY, account);
  router.update({
    context: {isAuthenticated: !!account, isEmailVerified: !!account?.isEmailVerified},
  });
}

export function signIn(account: Account) {
  changeAccount(account);
}

/** Removes the account and its saved data from this tab and sends it to /login. */
export function signOut() {
  changeAccount(null);
  void router.navigate({to: '/login'});
}

/**
 * Router redirects only take effect when thrown from route `beforeLoad`/loaders, so auth failures
 * surfaced by queries and mutations are turned into navigation here instead.
 */
const handleAuthError = (error: Error) => {
  if (error instanceof SessionExpiredError) {
    signOut();
  } else if (error instanceof EmailNotVerifiedError) {
    queryClient.setQueryData<Account | null>(
      CURRENT_ACCOUNT_KEY,
      (account) => account && {...account, isEmailVerified: false},
    );
    router.update({context: {isAuthenticated: true, isEmailVerified: false}});
    void router.navigate({to: '/verify-email'});
  }
};

/** Retrying cannot fix an auth error, nor a reply that belongs to a previous session. */
const isFinalError = (error: Error) =>
  error instanceof SessionExpiredError ||
  error instanceof EmailNotVerifiedError ||
  error instanceof SessionChangedError;

/**
 * A 401 from the signed-in check is how signed-out pages learn there is no session, so it must not
 * redirect. If this tab was showing a saved account, that account and its saved data are dropped.
 */
const handleQueryError = (error: Error, query: Query<unknown, unknown, unknown, QueryKey>) => {
  if (
    error instanceof HttpError &&
    error.status === 401 &&
    isAccountQuery(query) &&
    query.state.data
  ) {
    // A saved account this page load never confirmed was not on screen yet; the route decides.
    if (query.state.dataUpdatedAt < PAGE_LOADED_AT) dropSavedData(queryClient);
    else signOut();
    return;
  }
  handleAuthError(error);
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({onError: handleQueryError}),
  mutationCache: new MutationCache({onError: handleAuthError}),
  defaultOptions: {
    // Retrying an auth error would also delay the redirect until retries run out.
    queries: {
      gcTime: OFFLINE_MAX_AGE,
      retry: (failureCount, error) => !isFinalError(error) && failureCount < 3,
    },
    // Never queue a financial or account change for automatic replay after reconnect.
    mutations: {networkMode: 'always', retry: false},
  },
});
