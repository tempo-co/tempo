import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate, useRouter} from '@tanstack/react-router';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {Account} from '@/types/account';
import {HttpError, api} from '@/utils/api';

import {LogInDto} from '../types/login.dto';

export const useLogIn = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();

  const {mutate: logIn, isPending} = useMutation<Account, HttpError, LogInDto>({
    mutationFn: async (logInDto: LogInDto) => {
      return await api.post<Account>('/auth/login', JSON.stringify(logInDto));
    },
    onSuccess: (account) => {
      queryClient.setQueryData(CURRENT_ACCOUNT_KEY, account);
      router.update({context: {isAuthenticated: true, isEmailVerified: account.isEmailVerified}});

      if (!account.isEmailVerified) {
        return navigate({to: '/verify-email', replace: true});
      }
      return navigate({to: '/', replace: true});
    },
    retry: false,
  });
  return {logIn, isPending};
};
