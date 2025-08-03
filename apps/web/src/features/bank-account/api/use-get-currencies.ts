import {useQuery} from '@tanstack/react-query';

import {api} from '@/utils/api';

import {Currency} from '../types/currency';

export const useGetCurrencies = () => {
  const {data: currencies, isPending} = useQuery<Currency[]>({
    queryKey: ['currencies'],
    queryFn: async () => {
      return await api.get<Currency[]>('/currencies');
    },
    staleTime: Infinity,
  });

  return {currencies, isPending};
};
