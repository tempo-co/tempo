import {useMutation} from '@tanstack/react-query';
import type {PasswordChangeRequest} from '@tempo/contracts';
import {toast} from 'sonner';

import {HttpError, INVALID_PASSWORD_MESSAGE, api} from '@/utils/api';

export const useChangePassword = () => {
  const {mutateAsync: changePassword, isPending} = useMutation<
    void,
    HttpError,
    PasswordChangeRequest
  >({
    mutationFn: async (dto) => {
      await api.post('/auth/change-password', dto, {expectUnauthorized: INVALID_PASSWORD_MESSAGE});
    },
    onSuccess: () => {
      toast.success('Password changed.');
    },
  });

  return {changePassword, isPending};
};
