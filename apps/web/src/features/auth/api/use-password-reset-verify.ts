import {useMutation} from '@tanstack/react-query';
import type {MessageResponse, PasswordResetVerifyRequest} from '@tempo/contracts';

import {HttpError, api} from '@/utils/api';

export const usePasswordResetVerify = () => {
  const {
    mutateAsync: verifyPasswordReset,
    isPending,
    isSuccess,
    error,
  } = useMutation<MessageResponse, HttpError, PasswordResetVerifyRequest>({
    mutationFn: async (dto: PasswordResetVerifyRequest) => {
      return await api.post<MessageResponse>('/auth/reset-password/verify', dto);
    },
  });

  return {verifyPasswordReset, isPending, isSuccess, error};
};
