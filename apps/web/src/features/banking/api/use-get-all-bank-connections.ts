import {useQuery} from '@tanstack/react-query';

import {BankConnection} from '@/features/banking/types/bank-connection';
import {api} from '@/utils/api';

export const useGetAllBankConnections = () => {
  const {data: bankConnections, isPending} = useQuery<BankConnection[]>({
    queryKey: ['bank-connections'],
    queryFn: async () => {
      return await api.get<BankConnection[]>('/bank-connections');
    },
  });

  return {bankConnections, isPending};
};
