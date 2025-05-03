import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate, useRouter} from '@tanstack/react-router';

import {User} from '@/types/user';
import {HttpError, api} from '@/utils/api';

import {SignUpDto} from '../types/signup.dto';

export const useSignUp = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();

  const {mutateAsync: signUp, isPending} = useMutation<User, HttpError, SignUpDto>({
    mutationFn: async (signUpDto: SignUpDto) => {
      return await api.post<User>('/auth/signup', JSON.stringify(signUpDto));
    },
    onSuccess: (user) => {
      queryClient.setQueryData(['currentUser'], user);
      router.update({context: {isAuthenticated: true, isEmailVerified: user.isEmailVerified}});
      return navigate({to: '/verify'});
    },
    retry: false,
  });
  return {signUp, isPending};
};
