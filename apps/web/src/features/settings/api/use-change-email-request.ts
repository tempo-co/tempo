import {useMutation} from '@tanstack/react-query';

import {HttpError, api} from '@/utils/api';

import {EmailChangeDto} from '../types/email-change.dto';

export const useChangeEmailRequest = () => {
  const {mutateAsync: changeEmailRequest, isPending} = useMutation<void, HttpError, EmailChangeDto>(
    {
      mutationFn: async (dto) => {
        await api.post('/auth/change-email/request', JSON.stringify(dto));
      },
    },
  );

  return {changeEmailRequest, isPending};
};
