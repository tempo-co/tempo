import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {User} from '@/types/user';
import {HttpError, api} from '@/utils/api';

import {NameChangeDto} from '../types/name-change.dto';

export const usePatchUser = () => {
  const queryClient = useQueryClient();

  const {mutateAsync, isPending} = useMutation<User, HttpError, NameChangeDto>({
    mutationFn: async (dto) => {
      return await api.patch<User>('/users/me', JSON.stringify(dto));
    },
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(['currentUser'], updatedUser);
    },
  });

  const patchUser = (dto: NameChangeDto) => {
    return toast.promise(mutateAsync(dto), {
      loading: 'Saving name...',
      success: 'Name saved.',
      error: 'Your name could not be saved. Please try again',
    });
  };

  return {patchUser, isPending};
};
