import {useMutation} from '@tanstack/react-query';
import {toast} from 'sonner';

import {unsubscribeDevice} from '@/features/notifications/utils/push-device';
import {signOut} from '@/query-client';
import {beginLogout, completePendingLogout} from '@/utils/api';

export const useLogOut = () => {
  const {mutateAsync: logOut, isPending} = useMutation({
    // Resolves whether or not Tempo confirmed the logout; an unconfirmed one is retried later.
    mutationFn: async () => {
      try {
        beginLogout();
        await completePendingLogout();
        return true;
      } catch {
        return false;
      } finally {
        // Private data leaves this device even when the server cannot confirm the logout, and its alerts stop.
        signOut();
        void unsubscribeDevice().catch(() => {
          /* Tempo stops pushing to a logged-out session anyway. */
        });
      }
    },
    onSuccess: (confirmed) => {
      if (!confirmed)
        toast.error('Saved data was removed from this device', {
          description: 'Tempo will finish logging out once it is reachable.',
          id: 'logout-unconfirmed',
        });
    },
  });

  return {logOut, isPending};
};
