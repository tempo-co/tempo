import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {useState} from 'react';

import {BankAccount} from '@/types/bank-account';
import {BankStatement} from '@/types/bank-statement';
import {PaginationParams} from '@/types/pagination';
import {api} from '@/utils/api';

export type PaginatedBankStatementsResponse = {
  bankStatements: BankStatement[];
  total: number;
};

export const useGetAllBankStatements = (
  bankAccountId: BankAccount['id'],
  {pageIndex = 0, pageSize = 10}: PaginationParams,
) => {
  const [pagination, setPagination] = useState<PaginationParams>({pageIndex, pageSize});

  const {data, isPending, isPlaceholderData} = useQuery<PaginatedBankStatementsResponse>({
    queryKey: ['bank-statements', pagination, bankAccountId],
    queryFn: async () => {
      return await api.get<PaginatedBankStatementsResponse>(
        `/bank-accounts/${bankAccountId}/bank-statements?pageIndex=${pagination.pageIndex}&pageSize=${pagination.pageSize}`,
      );
    },
    placeholderData: keepPreviousData,
  });

  return {data, isPending, isPlaceholderData, pagination, setPagination};
};
