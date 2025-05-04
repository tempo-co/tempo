import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate, useRouter} from '@tanstack/react-router';
import {toast} from 'sonner';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {Account} from '@/types/account';
import {HttpError, api} from '@/utils/api';

import {LogInDto} from '../types/login.dto';

type useLogInProps = {
  returnTo?: string;
};

export const useLogIn = ({returnTo}: useLogInProps) => {
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
        return navigate({to: '/verify', replace: true});
      }

      if (returnTo) {
        if (returnTo == '/verify') {
          toast.info('Your email has already been verified.');
        }
        return navigate({to: returnTo, replace: true});
      }
      return navigate({to: '/home', replace: true});
    },
    retry: false,
  });
  return {logIn, isPending};
};
