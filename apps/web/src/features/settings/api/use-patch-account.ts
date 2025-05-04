import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {Account} from '@/types/account';
import {HttpError, api} from '@/utils/api';

import {NameChangeDto} from '../types/name-change.dto';

export const usePatchAccount = () => {
  const queryClient = useQueryClient();

  const {mutateAsync, isPending} = useMutation<Account, HttpError, NameChangeDto>({
    mutationFn: async (dto) => {
      return await api.patch<Account>('/accounts/me', JSON.stringify(dto));
    },
    onSuccess: (updatedAccount) => {
      queryClient.setQueryData(CURRENT_ACCOUNT_KEY, updatedAccount);
    },
  });

  const patchAccount = (dto: NameChangeDto) => {
    return toast.promise(mutateAsync(dto), {
      loading: 'Saving name...',
      success: 'Name saved.',
      error: 'Your name could not be saved. Please try again',
    });
  };

  return {patchAccount, isPending};
};
