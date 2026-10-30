import {useMutation} from '@tanstack/react-query';
import {
  BankConnectionAuthorizationRequest,
  BankConnectionAuthorizationResponse,
} from '@tempo/contracts';

import {api} from '@/utils/api';

export const useStartBankConnection = () => {
  const {mutateAsync: startBankConnection, isPending} = useMutation<
    BankConnectionAuthorizationResponse,
    Error,
    BankConnectionAuthorizationRequest
  >({
    mutationFn: async (request) => {
      return await api.post<BankConnectionAuthorizationResponse>(
        '/bank-connections/authorize',
        request,
      );
    },
  });

  return {startBankConnection, isPending};
};
