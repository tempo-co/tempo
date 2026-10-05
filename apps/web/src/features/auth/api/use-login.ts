import {useMutation} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';

import {signIn} from '@/query-client';
import {Account} from '@/types/account';
import {HttpError, api} from '@/utils/api';

import {LogInDto} from '../types/login.dto';

export const useLogIn = (redirectTo?: string) => {
  const navigate = useNavigate();

  const {mutate: logIn, isPending} = useMutation<Account, HttpError, LogInDto>({
    mutationFn: async (logInDto: LogInDto) => {
      return await api.post<Account>('/auth/login', JSON.stringify(logInDto));
    },
    onSuccess: (account) => {
      signIn(account);

      if (!account.isEmailVerified) {
        return navigate({to: '/verify-email', replace: true});
      }
      return redirectTo
        ? navigate({href: redirectTo, replace: true})
        : navigate({to: '/', replace: true});
    },
  });
  return {logIn, isPending};
};
