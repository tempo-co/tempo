import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {PaginationState} from '@tanstack/react-table';
import {useState} from 'react';
import {toast} from 'sonner';

import {Transaction} from '@/types/transaction';
import {api} from '@/utils/api';

type PaginatedTransactionsResponse = {
  transactions: Transaction[];
  total: number;
};

export const useGetAllTransactions = ({pageIndex = 0, pageSize = 10}: PaginationState) => {
  const [pagination, setPagination] = useState<PaginationState>({pageIndex, pageSize});

  const {data, isPending, isError, isPlaceholderData} = useQuery<PaginatedTransactionsResponse>({
    queryKey: ['transactions', pagination.pageIndex, pagination.pageSize],
    queryFn: async () => {
      const response = await api.get(
        `/transactions?pageIndex=${pagination.pageIndex}&pageSize=${pagination.pageSize}`,
      );
      return response.json();
    },
    placeholderData: keepPreviousData,
  });

  if (isError) {
    toast.error('There was a problem with your request.', {
      description: 'Your transactions could not be loaded. Please try again.',
    });
  }

  return {data, isPending, isPlaceholderData, pagination, setPagination};
};
