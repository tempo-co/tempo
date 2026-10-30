import {useMutation} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import type {Account, LogInRequest} from '@tempo/contracts';

import {signIn} from '@/query-client';
import {HttpError, api} from '@/utils/api';

export const useLogIn = (redirectTo?: string) => {
  const navigate = useNavigate();

  const {mutate: logIn, isPending} = useMutation<Account, HttpError, LogInRequest>({
    mutationFn: async (logInDto: LogInRequest) => {
      return await api.post<Account>('/auth/login', logInDto, {expectUnauthorized: true});
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
