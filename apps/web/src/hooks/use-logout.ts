import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';

import {api} from '@/utils/api';

export const useLogOut = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {mutateAsync: logOut, isPending} = useMutation({
    mutationFn: async () => {
      await api.post('/auth/logout');
      await queryClient.setQueryData(['currentUser'], null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: ['currentUser']});
      return navigate({to: '/'});
    },
    onError: async () => {
      return navigate({to: '/'});
    },
    retry: false,
  });

  return {logOut, isPending};
};
