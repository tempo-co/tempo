import type {BankTransactionFilter} from '@tempo/contracts';
import {format} from 'date-fns';

import type {BankTransactionFilterParams} from '../types/bank-transaction';

const formatDay = (date: Date | undefined) => date && format(date, 'yyyy-MM-dd');

/** The API's filter for `filters`, as a request body carries it; filters not in force are left out. */
export function toBankTransactionFilter(
  filters: BankTransactionFilterParams,
): BankTransactionFilter {
  const from = formatDay(filters.date?.from);
  const to = formatDay(filters.date?.to);
  const search = filters.search?.trim();
  return {
    ...((from || to) && {date: {...(from && {from}), ...(to && {to})}}),
    ...(filters.bankAccountIds?.length && {bankAccountIds: filters.bankAccountIds}),
    ...(filters.categories?.length && {categories: filters.categories}),
    ...(filters.categorySources?.length && {categorySources: filters.categorySources}),
    ...(filters.cashFlows?.length && {cashFlows: filters.cashFlows}),
    ...(filters.baseAmount && {baseAmount: filters.baseAmount}),
    ...(filters.categoryStatuses?.length && {categoryStatuses: filters.categoryStatuses}),
    ...(filters.recurringSeriesKey && {recurringSeriesKey: filters.recurringSeriesKey}),
    ...(filters.merchantGroup && {merchantGroup: filters.merchantGroup}),
    ...(filters.incomeSource && {incomeSource: filters.incomeSource}),
    // The rows the nav badge counts.
    ...(filters.needsAttention && {needsAttention: true}),
    ...(search && {search}),
  };
}

/** The `filter[...]` query parameters for `filters`; the list and its totals take the same ones. */
export function appendBankTransactionFilterParams(
  params: URLSearchParams,
  filters: BankTransactionFilterParams,
) {
  const filter = toBankTransactionFilter(filters);
  for (const [key, value] of Object.entries(filter)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(`filter[${key}][]`, item));
    else if (typeof value === 'object') {
      for (const [end, day] of Object.entries(value)) params.append(`filter[${key}][${end}]`, day);
    } else params.append(`filter[${key}]`, String(value));
  }
  return params;
}
