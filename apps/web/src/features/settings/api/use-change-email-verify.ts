import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {EmailVerifyDto} from '@/features/auth/types/email-verify.dto';
import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {Account} from '@/types/account';
import {HttpError, api} from '@/utils/api';

export const useChangeEmailVerify = () => {
  const queryClient = useQueryClient();
  const {mutateAsync: changeEmailVerify, isPending} = useMutation<
    Account,
    HttpError,
    EmailVerifyDto
  >({
    mutationFn: async (dto) => {
      return await api.post<Account>('/auth/change-email/verify', JSON.stringify(dto));
    },
    onSuccess: (account) => {
      queryClient.setQueryData(CURRENT_ACCOUNT_KEY, account);
      toast.success('Email verified', {
        description: `Your email has been changed to ${account.email}.`,
      });
    },
  });

  return {changeEmailVerify, isPending};
};
