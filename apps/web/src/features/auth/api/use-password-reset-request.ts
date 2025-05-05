import {useMutation} from '@tanstack/react-query';

import {HttpError, api} from '@/utils/api';

import {PasswordResetRequestDto} from '../types/password-reset-request.dto';

export const usePasswordResetRequest = () => {
  const {
    mutateAsync: requestPasswordReset,
    isPending,
    isSuccess,
    reset,
  } = useMutation<void, HttpError, PasswordResetRequestDto>({
    mutationFn: async (dto: PasswordResetRequestDto) => {
      return await api.post<void>('/auth/reset-password/request', JSON.stringify(dto));
    },
    retry: false,
  });

  return {requestPasswordReset, isPending, isSuccess, reset};
};
