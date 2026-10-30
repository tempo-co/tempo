import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import type {
  CreatedPersonalAccessToken,
  PersonalAccessToken,
  PersonalAccessTokenCreateRequest,
} from '@tempo/contracts';
import {toast} from 'sonner';

import {HttpError, api, wasToasted} from '@/utils/api';

const TOKENS_QUERY_KEY = ['personal-access-tokens'] as const;
const RESOURCE = '/personal-access-tokens';

export function usePersonalAccessTokens() {
  return useQuery({
    queryKey: TOKENS_QUERY_KEY,
    queryFn: () => api.get<PersonalAccessToken[]>(RESOURCE),
  });
}

export function useCreatePersonalAccessToken(onCreated: (token: string) => void) {
  const queryClient = useQueryClient();
  return useMutation<void, HttpError, PersonalAccessTokenCreateRequest>({
    mutationFn: async (dto) => {
      const created = await api.post<CreatedPersonalAccessToken>(RESOURCE, dto);
      // Only the open dialog owns the secret. Never return it into the mutation/query cache.
      onCreated(created.token);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({queryKey: TOKENS_QUERY_KEY});
    },
  });
}

export function useRevokePersonalAccessToken() {
  const queryClient = useQueryClient();
  return useMutation<void, HttpError, string>({
    mutationFn: async (id) => {
      await api.delete(`${RESOURCE}/${id}`);
    },
    onSuccess: (_data, id) => {
      toast.success('Access token revoked.');
      queryClient.setQueryData<PersonalAccessToken[]>(TOKENS_QUERY_KEY, (tokens) =>
        tokens?.filter((token) => token.id !== id),
      );
    },
    onError: (error) => {
      if (wasToasted(error)) return;
      toast.error('The token could not be revoked.');
    },
  });
}
