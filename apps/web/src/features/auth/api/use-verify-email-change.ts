import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {toast} from 'sonner';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {Account} from '@/types/account';
import {HttpError, api} from '@/utils/api';

import {EmailVerifyDto} from '../types/email-verify.dto';

export const useVerifyEmailChange = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {mutateAsync: verifyEmailChange, isPending} = useMutation<void, HttpError, EmailVerifyDto>({
    mutationFn: async (dto: EmailVerifyDto) => {
      return await api.post<void>('/auth/change-email/verify', JSON.stringify(dto));
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({queryKey: CURRENT_ACCOUNT_KEY});
      queryClient.setQueryData(CURRENT_ACCOUNT_KEY, (currentAccount: Account) => ({
        ...currentAccount,
        email: variables.email,
      }));

      await navigate({to: '/', replace: true});

      toast.success('Your new email has been verified.', {
        description: `Your email has been changed to ${variables.email}.`,
      });
    },
    onError: () => {
      toast.warning('Invalid verification link', {
        description: 'Please request a new link.',
      });
      throw navigate({to: '/'});
    },
    retry: false,
  });

  return {verifyEmailChange, isPending};
};
