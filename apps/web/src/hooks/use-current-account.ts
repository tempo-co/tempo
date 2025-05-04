import {useQuery} from '@tanstack/react-query';

import {Account} from '@/types/account';
import {HttpError, api} from '@/utils/api';

export const CURRENT_ACCOUNT_KEY = ['currentAccount'];

export const useCurrentAccount = ({skipFetch = false} = {}) => {
  const {
    data: currentAccount,
    isPending,
    error,
  } = useQuery<Account, HttpError>({
    queryKey: CURRENT_ACCOUNT_KEY,
    queryFn: async () => {
      return await api.get<Account>('/accounts/me');
    },
    enabled: !skipFetch,
    retry: false,
  });
  const isAuthenticated = !isPending && !!currentAccount && !error;
  const isEmailVerified = isAuthenticated && currentAccount?.isEmailVerified;

  return {currentAccount, isPending, isAuthenticated, isEmailVerified};
};
