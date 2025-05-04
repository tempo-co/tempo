import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate, useRouter} from '@tanstack/react-router';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {Account} from '@/types/account';
import {HttpError, api} from '@/utils/api';

import {SignUpDto} from '../types/signup.dto';

export const useSignUp = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();

  const {mutateAsync: signUp, isPending} = useMutation<Account, HttpError, SignUpDto>({
    mutationFn: async (signUpDto: SignUpDto) => {
      return await api.post<Account>('/auth/signup', JSON.stringify(signUpDto));
    },
    onSuccess: (account) => {
      queryClient.setQueryData(CURRENT_ACCOUNT_KEY, account);
      router.update({context: {isAuthenticated: true, isEmailVerified: account.isEmailVerified}});
      return navigate({to: '/verify-email', replace: true});
    },
    retry: false,
  });
  return {signUp, isPending};
};
