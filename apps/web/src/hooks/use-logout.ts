import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {toast} from 'sonner';

import {beginLogout, completePendingLogout, endSession} from '@/utils/api';
import {dropSavedData} from '@/utils/offline-storage';

import {CURRENT_ACCOUNT_KEY} from './use-current-account';

export const useLogOut = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {mutateAsync: logOut, isPending} = useMutation({
    mutationFn: async () => {
      try {
        beginLogout();
        await completePendingLogout();
      } finally {
        // Private data leaves this device even when the server cannot confirm the logout.
        endSession();
        dropSavedData(queryClient);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: CURRENT_ACCOUNT_KEY});
      return navigate({to: '/'});
    },
    onError: async () => {
      toast.error('Saved data was removed from this device', {
        description: 'Tempo will finish logging out once it is reachable.',
        id: 'logout-unconfirmed',
      });
      return navigate({to: '/'});
    },
  });

  return {logOut, isPending};
};
