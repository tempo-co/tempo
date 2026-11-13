import {useMutation} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import type {Account, SignUpRequest} from '@tempo/contracts';

import {browserTimeZone} from '@/features/settings/utils/time-zones';
import {signIn} from '@/query-client';
import {HttpError, api} from '@/utils/api';

export const useSignUp = () => {
  const navigate = useNavigate();

  const {mutateAsync: signUp, isPending} = useMutation<Account, HttpError, SignUpRequest>({
    mutationFn: async (signUpDto: SignUpRequest) => {
      // The account starts in this browser's time zone; the API stores its default when there is none.
      const body = {...signUpDto, timeZone: browserTimeZone()} satisfies SignUpRequest;
      return await api.post<Account>('/auth/signup', body);
    },
    onSuccess: (account) => {
      signIn(account);
      return navigate({to: '/verify-email', replace: true});
    },
  });
  return {signUp, isPending};
};
