import {useMutation} from '@tanstack/react-query';
import type {EmailChangeRequest} from '@tempo/contracts';

import {HttpError, INVALID_PASSWORD_MESSAGE, api} from '@/utils/api';

export const useChangeEmailRequest = () => {
  const {mutate: changeEmailRequest, isPending} = useMutation<void, HttpError, EmailChangeRequest>({
    mutationFn: async (dto) => {
      await api.post('/auth/change-email/request', dto, {
        expectUnauthorized: INVALID_PASSWORD_MESSAGE,
      });
    },
  });

  return {changeEmailRequest, isPending};
};
