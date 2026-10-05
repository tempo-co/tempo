import {useMutation} from '@tanstack/react-query';
import {toast} from 'sonner';

import {signOut} from '@/query-client';
import {HttpError, api} from '@/utils/api';

import {AccountDeleteDto} from '../types/account-delete.dto';

export const useDeleteAccount = () => {
  const {mutateAsync: deleteAccount, isPending} = useMutation<void, HttpError, AccountDeleteDto>({
    mutationFn: async (dto) => {
      await api.delete('/accounts/me', {body: JSON.stringify(dto)});
    },
    onSuccess: () => {
      toast.success('Account deleted.');
      signOut();
    },
  });

  return {deleteAccount, isPending};
};
