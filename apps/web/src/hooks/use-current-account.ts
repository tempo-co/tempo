import {useQuery} from '@tanstack/react-query';

import {Account} from '@/types/account';
import {HttpError, api} from '@/utils/api';

export const CURRENT_ACCOUNT_KEY = ['currentAccount'];

/** An account saved before this page load only decides routing once Tempo confirms it or is unreachable. */
export const PAGE_LOADED_AT = Date.now();

let savedSessionShown = false;
/** Records that the saved account is on screen because Tempo was unreachable when the page loaded. */
export const markSavedSessionShown = () => {
  savedSessionShown = true;
};
/** Once shown, the saved account stays on screen while Tempo confirms it after reconnecting. */
export const wasSavedSessionShown = () => savedSessionShown;

/** The signed-in check: the account, or a 401 when this browser has no session. */
export const currentAccountQuery = {
  queryKey: CURRENT_ACCOUNT_KEY,
  queryFn: async () => await api.get<Account>('/accounts/me', {expectUnauthorized: true}),
  retry: false,
};

export const useCurrentAccount = ({skipFetch = false} = {}) => {
  // Read only fields that change with the result: a re-render when a refetch merely starts would
  // push this stale account into the router context while a caller is about to navigate.
  const {data, isPending, error, refetch, dataUpdatedAt} = useQuery<Account, HttpError>({
    ...currentAccountQuery,
    enabled: !skipFetch,
    refetchOnWindowFocus: false,
  });

  const isAuthenticated = !!data && error?.status !== 401;
  const isUnavailable = !data && !!error && error.status !== 401;
  const isEmailVerified = isAuthenticated && data?.isEmailVerified;
  const isSavedSessionUnconfirmed = !!data && dataUpdatedAt < PAGE_LOADED_AT && !error;

  return {
    currentAccount: data,
    isPending,
    isAuthenticated,
    isEmailVerified,
    isUnavailable,
    isSavedSessionUnconfirmed,
    refetch,
  };
};
