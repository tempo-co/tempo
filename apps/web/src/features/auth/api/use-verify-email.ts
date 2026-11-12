import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate, useRouter} from '@tanstack/react-router';
import type {EmailVerifyRequest, MessageResponse} from '@tempo/contracts';
import {useCallback} from 'react';
import {toast} from 'sonner';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {HttpError, api} from '@/utils/api';

export const VERIFY_EMAIL_MUTATION_KEY = ['verify-email'];

/** Takes the signed-in browser whose email is now verified into the app. */
export const useContinueVerified = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();

  return useCallback(async () => {
    router.update({context: {isAuthenticated: true, isEmailVerified: true}});
    await queryClient.invalidateQueries({queryKey: CURRENT_ACCOUNT_KEY});

    await navigate({to: '/', replace: true});
    toast.success('Welcome to Tempo!', {
      description: 'Your email has been verified.',
      id: 'welcome',
    });
  }, [navigate, queryClient, router]);
};

/**
 * Verifying never signs in: the browser that signed up continues into the app; any other stays on
 * the page, which shows the email as confirmed.
 */
export const useVerifyEmail = () => {
  const router = useRouter();
  const continueVerified = useContinueVerified();

  const {
    mutateAsync: verifyEmail,
    isPending,
    isSuccess,
    error,
    reset,
  } = useMutation<MessageResponse, HttpError, EmailVerifyRequest>({
    mutationKey: VERIFY_EMAIL_MUTATION_KEY,
    mutationFn: async (dto: EmailVerifyRequest) => {
      return await api.post<MessageResponse>('/auth/signup/verify', dto);
    },
    onSuccess: async () => {
      if (router.options.context.isAuthenticated) await continueVerified();
    },
  });

  return {verifyEmail, isPending, isSuccess, error, reset};
};
