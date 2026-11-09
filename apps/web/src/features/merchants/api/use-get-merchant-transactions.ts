import {useTransactionPages} from '@/features/banking/api/use-transaction-pages';

import {merchantQueryKeys} from './merchant-query-keys';

/** A merchant group's transactions, newest first, a page at a time. */
export const useGetMerchantTransactions = (id: string) =>
  useTransactionPages(merchantQueryKeys.transactions(id), {'filter[merchantGroup]': id});
