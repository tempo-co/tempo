import {useMutation, useQueryClient} from '@tanstack/react-query';
import type {MessageResponse, Session} from '@wisp/contracts';
import {toast} from 'sonner';

import {HttpError, api} from '@/utils/api';

import {SESSIONS_QUERY_KEY} from './query-keys';

export const useRevokeSession = () => {
  const queryClient = useQueryClient();

  const {mutateAsync, isPending} = useMutation<void, HttpError, {id: Session['id']}>({
    mutationFn: async ({id}) => {
      await api.delete<MessageResponse>(`/auth/sessions/${id}`);
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
      }
    },
  });

  // A session that is already gone needs no retry: its toast says so and the list refreshes.
  const revokeSession = async (input: {id: Session['id']}) => {
    try {
      await mutateAsync(input);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return;
      throw error;
    }
  };

  return {revokeSession, isPending};
};
