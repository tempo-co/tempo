import {useQuery} from '@tanstack/react-query';

import {api} from '@/utils/api';

import {Session} from '../types/session';

export const useGetSessions = () => {
  const {
    data: sessions,
    isError,
    isPending,
    refetch,
  } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: async () => {
      return await api.get<Session[]>('/auth/sessions');
    },
  });

  return {sessions, isError, isPending, refetch};
};
