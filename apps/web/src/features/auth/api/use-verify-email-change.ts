import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useCallback} from 'react';
import {toast} from 'sonner';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {Account} from '@/types/account';
import {HttpError, api} from '@/utils/api';

import {TokenSearchParams} from '../types/token.dto';

export const useVerifyEmailChange = () => {
  const queryClient = useQueryClient();

  const {mutateAsync, isPending, isSuccess} = useMutation<void, HttpError, TokenSearchParams>({
    mutationFn: async (dto: TokenSearchParams) => {
      await api.post('/auth/change-email/verify', JSON.stringify(dto));
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({queryKey: CURRENT_ACCOUNT_KEY});
      queryClient.setQueryData(CURRENT_ACCOUNT_KEY, (currentAccount: Account) => ({
        ...currentAccount,
        email: variables.email,
      }));
    },
  });

  const verifyEmailChange = useCallback(
    (dto: TokenSearchParams) => {
      return toast.promise(mutateAsync(dto), {
        loading: 'Verifying your new email...',
        success: 'Your new email has been verified.',
        error: 'This verification link is invalid or has expired.',
        id: 'verify-email-promise-toast',
      });
    },
    [mutateAsync],
  );

  return {verifyEmailChange, isPending, isSuccess};
};
