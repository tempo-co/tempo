import {useMutation, useQueryClient} from '@tanstack/react-query';
import type {Account, AccountUpdateRequest} from '@tempo/contracts';
import {toast} from 'sonner';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {HttpError, api, wasToasted} from '@/utils/api';
import {toastRequest} from '@/utils/toast-request';

const useAccountMutation = () => {
  const queryClient = useQueryClient();

  return useMutation<Account, HttpError, AccountUpdateRequest>({
    mutationFn: async (dto) => {
      return await api.patch<Account>('/accounts/me', dto);
    },
    onSuccess: (updatedAccount) => {
      queryClient.setQueryData(CURRENT_ACCOUNT_KEY, updatedAccount);
    },
  });
};

export const usePatchAccount = () => {
  const {mutateAsync, isPending} = useAccountMutation();

  const patchAccount = (dto: AccountUpdateRequest) => {
    return toastRequest(mutateAsync(dto), {
      loading: 'Saving name...',
      success: 'Name saved.',
      error: 'Your name could not be saved. Please try again',
    });
  };

  return {patchAccount, isPending};
};

/** Saves the account's time zone. The row shows the result, so only a failure toasts. */
export const useUpdateTimeZone = () => {
  const {mutateAsync, isPending} = useAccountMutation();

  const updateTimeZone = async (timeZone: string) => {
    try {
      return await mutateAsync({timeZone});
    } catch (error) {
      if (!wasToasted(error)) toast.error('Your time zone could not be saved. Please try again.');
      throw error;
    }
  };

  return {updateTimeZone, isPending};
};
