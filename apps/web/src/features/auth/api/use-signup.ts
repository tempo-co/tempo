import {useMutation} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';

import {signIn} from '@/query-client';
import {Account} from '@/types/account';
import {HttpError, api} from '@/utils/api';

import {SignUpDto} from '../types/signup.dto';

export const useSignUp = () => {
  const navigate = useNavigate();

  const {mutateAsync: signUp, isPending} = useMutation<Account, HttpError, SignUpDto>({
    mutationFn: async (signUpDto: SignUpDto) => {
      return await api.post<Account>('/auth/signup', JSON.stringify(signUpDto));
    },
    onSuccess: (account) => {
      signIn(account);
      return navigate({to: '/verify-email', replace: true});
    },
  });
  return {signUp, isPending};
};
