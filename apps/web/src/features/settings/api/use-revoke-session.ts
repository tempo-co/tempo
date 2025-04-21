import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {HttpError, api} from '@/utils/api';

import {Session} from '../types/session';
import {SessionRevokeDto} from '../types/session-revoke.dto';

export const useRevokeSession = () => {
  const queryClient = useQueryClient();

  const {mutateAsync, isPending} = useMutation<
    void,
    HttpError,
    {id: Session['id']; dto: SessionRevokeDto}
  >({
    mutationFn: async ({id, dto}) => {
      await api.delete<Session>(`/auth/sessions/${id}`, {body: JSON.stringify(dto)});
    },

    onSuccess: (_data, data) => {
      toast.success('Session revoked.');

      queryClient.setQueryData<Session[]>(['sessions'], (prevSessions) => {
        return prevSessions?.filter((session) => session.id !== data.id);
      });
    },
    onError: async (error) => {
      if (error.status === 404) {
        toast.error('Session not found or expired.');
        await queryClient.invalidateQueries({queryKey: ['sessions']});
        throw error;
      }
    },
  });

  return {revokeSession: mutateAsync, isPending};
};
