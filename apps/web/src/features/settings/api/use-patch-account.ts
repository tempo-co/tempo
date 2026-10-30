import {useMutation, useQueryClient} from '@tanstack/react-query';
import type {Account, AccountUpdateRequest} from '@tempo/contracts';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {HttpError, api} from '@/utils/api';
import {toastRequest} from '@/utils/toast-request';

export const usePatchAccount = () => {
  const queryClient = useQueryClient();

  const {mutateAsync, isPending} = useMutation<Account, HttpError, AccountUpdateRequest>({
    mutationFn: async (dto) => {
      return await api.patch<Account>('/accounts/me', dto);
    },
    onSuccess: (updatedAccount) => {
      queryClient.setQueryData(CURRENT_ACCOUNT_KEY, updatedAccount);
    },
  });

  const patchAccount = (dto: AccountUpdateRequest) => {
    return toastRequest(mutateAsync(dto), {
      loading: 'Saving name...',
      success: 'Name saved.',
      error: 'Your name could not be saved. Please try again',
    });
  };

  return {patchAccount, isPending};
};
