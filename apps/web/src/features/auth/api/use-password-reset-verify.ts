import {useMutation} from '@tanstack/react-query';

import {HttpError, api} from '@/utils/api';

import {PasswordResetVerifyDto} from '../types/password-reset-verify.dto';

export const usePasswordResetVerify = () => {
  const {
    mutateAsync: verifyPasswordReset,
    isPending,
    isSuccess,
    error,
  } = useMutation<void, HttpError, PasswordResetVerifyDto>({
    mutationFn: async (dto: PasswordResetVerifyDto) => {
      return await api.post<void>('/auth/reset-password/verify', JSON.stringify(dto));
    },
    retry: false,
  });

  return {verifyPasswordReset, isPending, isSuccess, error};
};
