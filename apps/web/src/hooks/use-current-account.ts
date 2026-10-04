import {useQuery} from '@tanstack/react-query';

import {Account} from '@/types/account';
import {HttpError, api} from '@/utils/api';

export const CURRENT_ACCOUNT_KEY = ['currentAccount'];

/** An account saved before this page load only decides routing once Tempo confirms it or is unreachable. */
export const PAGE_LOADED_AT = Date.now();

export const useCurrentAccount = ({skipFetch = false} = {}) => {
  // Read only fields that change with the result: a re-render when a refetch merely starts would
  // push this stale account into the router context while a caller is about to navigate.
  const {data, isPending, error, refetch, dataUpdatedAt} = useQuery<Account, HttpError>({
    queryKey: CURRENT_ACCOUNT_KEY,
    queryFn: async () => {
      return await api.get<Account>('/accounts/me');
    },
    enabled: !skipFetch,
    retry: false,
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
