import {useQuery} from '@tanstack/react-query';

import {api} from '@/utils/api';

import {Session} from '../types/session';
import {SESSIONS_QUERY_KEY} from './query-keys';

export const useGetSessions = () => {
  const {
    data: sessions,
    isError,
    isPending,
    refetch,
  } = useQuery<Session[]>({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: async () => {
      return await api.get<Session[]>('/auth/sessions');
    },
  });

  return {sessions, isError, isPending, refetch};
};
