import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {HttpError, api} from '@/utils/api';

import {AccountDeleteDto} from '../types/account-delete.dto';

export const useDeleteAccount = () => {
  const queryClient = useQueryClient();

  const {mutateAsync: deleteAccount, isPending} = useMutation<void, HttpError, AccountDeleteDto>({
    mutationFn: async (dto) => {
      await api.delete('/accounts/me', {body: JSON.stringify(dto)});
    },
    onSuccess: async () => {
      toast.success('Account deleted.');
      queryClient.removeQueries();
      await queryClient.setQueryData(CURRENT_ACCOUNT_KEY, null);
    },
    retry: false,
  });

  return {deleteAccount, isPending};
};
