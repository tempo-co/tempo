import {useMutation} from '@tanstack/react-query';
import type {MessageResponse, PasswordResetRequest} from '@tempo/contracts';

import {HttpError, api} from '@/utils/api';

export const usePasswordResetRequest = () => {
  const {
    mutateAsync: requestPasswordReset,
    isPending,
    isSuccess,
    reset,
  } = useMutation<MessageResponse, HttpError, PasswordResetRequest>({
    mutationFn: async (dto: PasswordResetRequest) => {
      return await api.post<MessageResponse>('/auth/reset-password/request', dto);
    },
  });

  return {requestPasswordReset, isPending, isSuccess, reset};
};
