import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate, useRouter} from '@tanstack/react-router';
import type {EmailVerifyRequest, MessageResponse} from '@tempo/contracts';
import {toast} from 'sonner';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {HttpError, api} from '@/utils/api';

/** Verifying never signs in: the browser that signed up stays signed in, any other goes to login. */
export const useVerifyEmail = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();

  const {
    mutateAsync: verifyEmail,
    isPending,
    error,
    reset,
  } = useMutation<MessageResponse, HttpError, EmailVerifyRequest>({
    mutationFn: async (dto: EmailVerifyRequest) => {
      return await api.post<MessageResponse>('/auth/signup/verify', dto);
    },
    onSuccess: async () => {
      if (!router.options.context.isAuthenticated) {
        await navigate({to: '/login', replace: true});
        toast.success('Your email has been verified.', {
          description: 'Log in to start using Tempo.',
          id: 'email-verified-log-in',
        });
        return;
      }

      router.update({context: {isAuthenticated: true, isEmailVerified: true}});
      await queryClient.invalidateQueries({queryKey: CURRENT_ACCOUNT_KEY});

      await navigate({to: '/', replace: true});
      toast.success('Welcome to Tempo!', {
        description: 'Your email has been verified.',
        id: 'welcome',
      });
    },
  });

  return {verifyEmail, isPending, error, reset};
};
