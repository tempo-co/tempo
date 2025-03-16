import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate, useRouter} from '@tanstack/react-router';
import {toast} from 'sonner';

import {User} from '@/types/user';
import {HttpError, api} from '@/utils/api';

import {EmailVerifyDto} from '../types/email-verify.dto';

export const useVerifyEmail = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();

  const {mutateAsync: verifyEmail, isPending} = useMutation<User, HttpError, EmailVerifyDto>({
    mutationFn: async (dto: EmailVerifyDto) => {
      const response = await api.post('/auth/signup/verify', JSON.stringify(dto));
      const user = (await response.json()) as User;
      return user;
    },
    onSuccess: async (user) => {
      toast.success('Welcome to Flair!', {
        description: 'Your email has been verified.',
      });

      queryClient.setQueryData(['currentUser'], user);
      router.update({context: {isAuthenticated: true, isEmailVerified: user.isEmailVerified}});
      return navigate({to: '/home'});
    },
    retry: false,
  });

  return {verifyEmail, isPending};
};
