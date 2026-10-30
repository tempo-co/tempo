import {useMutation} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import type {Account, SignUpRequest} from '@tempo/contracts';

import {signIn} from '@/query-client';
import {HttpError, api} from '@/utils/api';

export const useSignUp = () => {
  const navigate = useNavigate();

  const {mutateAsync: signUp, isPending} = useMutation<Account, HttpError, SignUpRequest>({
    mutationFn: async (signUpDto: SignUpRequest) => {
      return await api.post<Account>('/auth/signup', signUpDto);
    },
    onSuccess: (account) => {
      signIn(account);
      return navigate({to: '/verify-email', replace: true});
    },
  });
  return {signUp, isPending};
};
