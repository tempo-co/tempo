import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {HttpError, api} from '@/utils/api';
import {dropSavedData} from '@/utils/offline-storage';

import {AccountDeleteDto} from '../types/account-delete.dto';

export const useDeleteAccount = () => {
  const queryClient = useQueryClient();

  const {mutateAsync: deleteAccount, isPending} = useMutation<void, HttpError, AccountDeleteDto>({
    mutationFn: async (dto) => {
      await api.delete('/accounts/me', {body: JSON.stringify(dto)});
    },
    onSuccess: () => {
      toast.success('Account deleted.');
      dropSavedData(queryClient);
    },
  });

  return {deleteAccount, isPending};
};
