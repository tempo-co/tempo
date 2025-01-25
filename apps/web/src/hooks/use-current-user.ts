import {useQuery} from '@tanstack/react-query';

import {User} from '@/types/user';
import {HttpError, api} from '@/utils/api';

export const useCurrentUser = () => {
  const {
    data: currentUser,
    isPending,
    error,
  } = useQuery<User, HttpError>({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const response = await api.get('/users/me');
      return response.json();
    },
    retry: false,
  });

  return {currentUser, isPending, error, isAuthenticated: !!currentUser};
};
