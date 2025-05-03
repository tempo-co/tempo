import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {User} from '@/types/user';
import {HttpError, api} from '@/utils/api';

import {UsernameChangeDto} from '../types/username-change.dto';

export const usePatchUser = () => {
  const queryClient = useQueryClient();

  const {mutateAsync, isPending} = useMutation<User, HttpError, UsernameChangeDto>({
    mutationFn: async (dto) => {
      return await api.patch<User>('/users/me', JSON.stringify(dto));
    },
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(['currentUser'], updatedUser);
    },
  });

  const patchUser = (dto: UsernameChangeDto) => {
    return toast.promise(mutateAsync(dto), {
      loading: 'Saving username...',
      success: 'Username saved.',
      error: 'Your username could not be saved. Please try again',
    });
  };

  return {patchUser, isPending};
};
