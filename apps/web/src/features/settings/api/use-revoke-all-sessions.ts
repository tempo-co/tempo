import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {HttpError, api} from '@/utils/api';

import {Session} from '../types/session';
import {SESSIONS_QUERY_KEY} from './query-keys';

export const useRevokeAllSessions = () => {
  const queryClient = useQueryClient();

  const {mutateAsync, isPending} = useMutation<void, HttpError, void>({
    mutationFn: async () => {
      await api.delete<Session>(`/auth/sessions`);
    },

    onSuccess: () => {
      toast.success('All other sessions have been revoked.');

      queryClient.setQueryData<Session[]>(SESSIONS_QUERY_KEY, (prevSessions) => {
        return prevSessions?.filter((session) => session.isCurrent === true);
      });
    },
  });

  return {revokeAllSessions: mutateAsync, isPending};
};
