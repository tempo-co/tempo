import {MutationCache, QueryCache, QueryClient} from '@tanstack/react-query';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {Account} from '@/types/account';
import {EmailNotVerifiedError, SessionExpiredError} from '@/utils/api';

import {router} from './router';

/**
 * Router redirects only take effect when thrown from route `beforeLoad`/loaders, so auth failures
 * surfaced by queries and mutations are turned into navigation here instead.
 */
const handleAuthError = (error: Error) => {
  if (error instanceof SessionExpiredError) {
    queryClient.setQueryData(CURRENT_ACCOUNT_KEY, null);
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

export const queryClient = new QueryClient({
  queryCache: new QueryCache({onError: handleAuthError}),
  mutationCache: new MutationCache({onError: handleAuthError}),
  defaultOptions: {
    // Retrying cannot fix an auth error and would delay the redirect until retries run out.
    queries: {retry: (failureCount, error) => !isAuthError(error) && failureCount < 3},
  },
});
