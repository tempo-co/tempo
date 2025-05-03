import {useMutation} from '@tanstack/react-query';

import {HttpError, api} from '@/utils/api';

export const useCheckEmailAvailability = () => {
  const {mutateAsync: checkEmailAvailability, isPending} = useMutation<void, HttpError, string>({
    mutationFn: async (email) => {
      await api.head(`/auth/change-email/check?email=${encodeURIComponent(email)}`);
    },
  });

  return {checkEmailAvailability, isPending};
};
