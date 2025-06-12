import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate, useRouter} from '@tanstack/react-router';
import {toast} from 'sonner';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {Account} from '@/types/account';
import {HttpError, api} from '@/utils/api';

import {EmailVerifyDto} from '../types/email-verify.dto';

export const useVerifyEmail = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();

  const {
    mutateAsync: verifyEmail,
    isPending,
    error,
    reset,
  } = useMutation<Account, HttpError, EmailVerifyDto>({
    mutationFn: async (dto: EmailVerifyDto) => {
      return await api.post<Account>('/auth/signup/verify', JSON.stringify(dto));
    },
    onSuccess: async () => {
      router.update({context: {isAuthenticated: true, isEmailVerified: true}});
      await queryClient.invalidateQueries({queryKey: CURRENT_ACCOUNT_KEY});

      await navigate({to: '/', replace: true});
      toast.success('Welcome to Flair!', {description: 'Your email has been verified.'});
    },
    retry: false,
  });

  return {verifyEmail, isPending, error, reset};
};
