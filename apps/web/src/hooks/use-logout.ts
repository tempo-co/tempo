import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';

import {api} from '@/utils/api';

import {CURRENT_ACCOUNT_KEY} from './use-current-account';

export const useLogOut = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {mutateAsync: logOut, isPending} = useMutation({
    mutationFn: async () => {
      await api.post('/auth/logout');
      await queryClient.setQueryData(CURRENT_ACCOUNT_KEY, null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: CURRENT_ACCOUNT_KEY});
      return navigate({to: '/'});
    },
    onError: async () => {
      return navigate({to: '/'});
    },
    retry: false,
  });

  return {logOut, isPending};
};
