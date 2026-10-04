import {
  MutationCache,
  type Query,
  QueryCache,
  QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import {CURRENT_ACCOUNT_KEY, PAGE_LOADED_AT} from '@/hooks/use-current-account';
import {Account} from '@/types/account';
import {EmailNotVerifiedError, HttpError, SessionExpiredError, endSession} from '@/utils/api';
import {OFFLINE_MAX_AGE, dropSavedData} from '@/utils/offline-storage';

import {router} from './router';

/**
 * Router redirects only take effect when thrown from route `beforeLoad`/loaders, so auth failures
 * surfaced by queries and mutations are turned into navigation here instead.
 */
const handleAuthError = (error: Error) => {
  if (error instanceof SessionExpiredError) {
    endSession();
    dropSavedData(queryClient);
    router.update({context: {isAuthenticated: false, isEmailVerified: false}});
    void router.navigate({to: '/login'});
  } else if (error instanceof EmailNotVerifiedError) {
    queryClient.setQueryData<Account | null>(
      CURRENT_ACCOUNT_KEY,
      (account) => account && {...account, isEmailVerified: false},
    );
    router.update({context: {isAuthenticated: true, isEmailVerified: false}});
    void router.navigate({to: '/verify-email'});
  }
};

const isAuthError = (error: Error) =>
  error instanceof SessionExpiredError || error instanceof EmailNotVerifiedError;

/**
 * A 401 from the signed-in check is how signed-out pages learn there is no session, so it must not
 * redirect. If this tab was showing a saved account, that account and its saved data are dropped.
 */
const handleQueryError = (error: Error, query: Query<unknown, unknown, unknown, QueryKey>) => {
  if (
    error instanceof HttpError &&
    error.status === 401 &&
    query.queryKey[0] === CURRENT_ACCOUNT_KEY[0] &&
    query.state.data
  ) {
    // A saved account this page load never confirmed was not on screen yet; the route decides.
    if (query.state.dataUpdatedAt < PAGE_LOADED_AT) dropSavedData(queryClient);
    else handleAuthError(new SessionExpiredError(error.status, error.message));
    return;
  }
  handleAuthError(error);
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({onError: handleQueryError}),
  mutationCache: new MutationCache({onError: handleAuthError}),
  defaultOptions: {
    // Retrying cannot fix an auth error and would delay the redirect until retries run out.
    queries: {
      gcTime: OFFLINE_MAX_AGE,
      retry: (failureCount, error) => !isAuthError(error) && failureCount < 3,
    },
    // Never queue a financial or account change for automatic replay after reconnect.
    mutations: {networkMode: 'always', retry: false},
  },
});
