import {format} from 'date-fns';

import type {BankTransactionFilterParams} from '../types/bank-transaction';

const appendArrayFilter = (
  params: URLSearchParams,
  key: string,
  values: readonly string[] | undefined,
) => {
  values?.forEach((value) => params.append(key, value));
};

/** The `filter[...]` query parameters for `filters`; the list and its totals take the same ones. */
export function appendBankTransactionFilterParams(
  params: URLSearchParams,
  filters: BankTransactionFilterParams,
) {
  if (filters.date?.from) {
    params.append('filter[date][from]', format(filters.date.from, 'yyyy-MM-dd'));
  }
  if (filters.date?.to) {
    params.append('filter[date][to]', format(filters.date.to, 'yyyy-MM-dd'));
  }
  appendArrayFilter(params, 'filter[bankAccountIds][]', filters.bankAccountIds);
  appendArrayFilter(params, 'filter[categories][]', filters.categories);
  appendArrayFilter(params, 'filter[categorySources][]', filters.categorySources);
  appendArrayFilter(params, 'filter[cashFlows][]', filters.cashFlows);
  if (filters.baseAmount) {
    params.append('filter[baseAmount]', filters.baseAmount);
  }
  appendArrayFilter(params, 'filter[categoryStatuses][]', filters.categoryStatuses);
  if (filters.recurringSeriesKey) {
    params.append('filter[recurringSeriesKey]', filters.recurringSeriesKey);
  }
  if (filters.merchantGroup) {
    params.append('filter[merchantGroup]', filters.merchantGroup);
  }
  if (filters.incomeSource) {
    params.append('filter[incomeSource]', filters.incomeSource);
  }
  // The rows the nav badge counts.
  if (filters.needsAttention) {
    params.append('filter[needsAttention]', 'true');
  }
  if (filters.search?.trim()) {
    params.append('filter[search]', filters.search.trim());
  }
  return params;
}
