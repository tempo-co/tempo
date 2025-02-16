import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {PaginationState} from '@tanstack/react-table';
import {useState} from 'react';
import {toast} from 'sonner';

import {Account} from '@/types/account';
import {BankStatement} from '@/types/bank-statement';
import {api} from '@/utils/api';

export type PaginatedBankStatementsResponse = {
  bankStatements: BankStatement[];
  total: number;
};

export const useGetAllBankStatements = (
  accountId: Account['id'],
  {pageIndex = 0, pageSize = 10}: PaginationState,
) => {
  const [pagination, setPagination] = useState<PaginationState>({pageIndex, pageSize});

  const {data, isPending, isError, isPlaceholderData} = useQuery<PaginatedBankStatementsResponse>({
    queryKey: ['bank-statements', pagination, accountId],
    queryFn: async () => {
      const response = await api.get(
        `/accounts/${accountId}/bank-statements?pageIndex=${pagination.pageIndex}&pageSize=${pagination.pageSize}`,
      );
      return response.json();
    },
    placeholderData: keepPreviousData,
  });

  if (isError) {
    toast.error('There was a problem with your request.', {
      description: 'Your bank statements could not be loaded. Please try again.',
    });
  }

  return {data, isPending, isPlaceholderData, pagination, setPagination};
};
