import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {Account} from '@/types/account';
import {HttpError, api} from '@/utils/api';

import {TokenSearchParams} from '../types/token.dto';

const TOAST_ID = 'verify-email-change';

export const useVerifyEmailChange = () => {
  const queryClient = useQueryClient();

  const {mutate: verifyEmailChange, isPending} = useMutation<void, HttpError, TokenSearchParams>({
    mutationFn: async (dto: TokenSearchParams) => {
      await api.post('/auth/change-email/verify', JSON.stringify(dto));
    },
    onMutate: () => {
      toast.loading('Confirming your new email…', {id: TOAST_ID});
    },
    onSuccess: async (_data, {email}) => {
      queryClient.setQueryData(CURRENT_ACCOUNT_KEY, (account?: Account) =>
        account && email ? {...account, email} : account,
      );
      await queryClient.invalidateQueries({queryKey: CURRENT_ACCOUNT_KEY});
      toast.success('Email changed', {
        id: TOAST_ID,
        description: `You'll now sign in with ${email}.`,
      });
    },
    onError: () => {
      toast.error('This verification link is invalid or has expired.', {
        id: TOAST_ID,
        description: 'Use Change email to send a new one.',
      });
    },
  });

  return {verifyEmailChange, isPending};
};
