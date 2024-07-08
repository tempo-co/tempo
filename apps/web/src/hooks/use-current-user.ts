import {User} from '@/types/user';
import {api, HttpError} from '@/utils/api';
import {useQuery} from '@tanstack/react-query';

export const useCurrentUser = () => {
  const {
    data: currentUser,
    isPending,
    error,
  } = useQuery<User, HttpError>({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const user = await api.get('/users/me');
      return user.json();
    },
    retry: false,
  });

  return {currentUser, isPending, error, isAuthenticated: !!currentUser};
};
