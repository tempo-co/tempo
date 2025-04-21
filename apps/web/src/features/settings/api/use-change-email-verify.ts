import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {EmailVerifyDto} from '@/features/auth/types/email-verify.dto';
import {User} from '@/types/user';
import {HttpError, api} from '@/utils/api';

export const useChangeEmailVerify = () => {
  const queryClient = useQueryClient();
  const {mutateAsync: changeEmailVerify, isPending} = useMutation<User, HttpError, EmailVerifyDto>({
    mutationFn: async (dto) => {
      return await api.post<User>('/auth/change-email/verify', JSON.stringify(dto));
    },
    onSuccess: (user) => {
      queryClient.setQueryData(['currentUser'], user);
      toast.success('Email verified', {
        description: `Your email has been changed to ${user.email}.`,
      });
    },
  });

  return {changeEmailVerify, isPending};
};
