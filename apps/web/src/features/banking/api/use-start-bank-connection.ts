import {useMutation} from '@tanstack/react-query';

import {api} from '@/utils/api';

import {
  BankConnectionAuthorizationRequest,
  BankConnectionAuthorizationResponse,
} from '../types/bank-connection';

export const useStartBankConnection = () => {
  const {mutateAsync: startBankConnection, isPending} = useMutation<
    BankConnectionAuthorizationResponse,
    Error,
    BankConnectionAuthorizationRequest
  >({
    mutationFn: async (request) => {
      return await api.post<BankConnectionAuthorizationResponse>(
        '/bank-connections/authorize',
        JSON.stringify(request),
      );
    },
    retry: false,
  });

  return {startBankConnection, isPending};
};
