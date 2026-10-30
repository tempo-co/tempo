import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {HttpError, api} from '@/utils/api';

import {Session} from '../types/session';
import {SESSIONS_QUERY_KEY} from './query-keys';

export const useRevokeSession = () => {
  const queryClient = useQueryClient();

  const {mutateAsync, isPending} = useMutation<void, HttpError, {id: Session['id']}>({
    mutationFn: async ({id}) => {
      await api.delete<Session>(`/auth/sessions/${id}`);
    },

    onSuccess: (_data, data) => {
      toast.success('Session revoked.');

      queryClient.setQueryData<Session[]>(SESSIONS_QUERY_KEY, (prevSessions) => {
        return prevSessions?.filter((session) => session.id !== data.id);
      });
    },
    onError: async (error) => {
      if (error.status === 404) {
        toast.error('Session not found or expired.');
        await queryClient.invalidateQueries({queryKey: SESSIONS_QUERY_KEY});
        throw error;
      }
    },
  });

  return {revokeSession: mutateAsync, isPending};
};
