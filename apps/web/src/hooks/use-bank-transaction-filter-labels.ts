import {format, isSameDay, startOfDay} from 'date-fns';

import {useActiveBankAccounts} from '@/features/banking/api/use-active-bank-accounts';
import {
  BANK_TRANSACTION_CATEGORY_LABELS,
  BANK_TRANSACTION_FILTER_KEYS,
  type BankTransactionFilterParams,
} from '@/features/banking/types/bank-transaction';
import {BOOKING_DATE_PRESETS} from '@/features/banking/utils/booking-date-presets';
import {CASH_FLOW_LABELS, CATEGORY_STATUS_LABELS} from '@/features/banking/utils/drill-filters';
import {formatBankTransactionCategorySource} from '@/features/banking/utils/formatters';

export type BankTransactionFilterKey = (typeof BANK_TRANSACTION_FILTER_KEYS)[number];

/** One filter in force as the chips and the Filters panel name it. `phoneOnly` filters have a toolbar control on larger screens. */
export type FilterLabel = {key: BankTransactionFilterKey; label: string; phoneOnly?: boolean};

const list = (labels: string[], noun: string) =>
  labels.length <= 2 ? labels.join(', ') : `${labels.length} ${noun}`;

function dateLabel(range: NonNullable<BankTransactionFilterParams['bookingDate']>) {
  const today = startOfDay(new Date());
  const preset = BOOKING_DATE_PRESETS.find(({getRange}) => {
    const r = getRange(today);
    return range.from && isSameDay(r.from, range.from) && range.to && isSameDay(r.to, range.to);
  });
  if (preset) return preset.label;
  if (!range.from) return 'Any date';
  const from = format(range.from, 'd MMM yyyy');
  return range.to && !isSameDay(range.from, range.to)
    ? `${from} – ${format(range.to, 'd MMM yyyy')}`
    : from;
}

/** One short label per filter in force, in the order the chips show them; the Filters panel summarizes with them. */
export function useBankTransactionFilterLabels(filters: BankTransactionFilterParams) {
  const {accounts, needsAccountName} = useActiveBankAccounts();
  const chips: FilterLabel[] = [];
  if (filters.needsAttention) chips.push({key: 'needsAttention', label: 'To review'});
  if (filters.bookingDate?.from)
    chips.push({key: 'bookingDate', label: dateLabel(filters.bookingDate), phoneOnly: true});
  if (filters.categories?.length)
    chips.push({
      key: 'categories',
      label: list(
        filters.categories.map((value) =>
          value === 'UNCATEGORIZED' ? 'Not categorized' : BANK_TRANSACTION_CATEGORY_LABELS[value],
        ),
        'categories',
      ),
    });
  if (filters.cashFlows?.length)
    chips.push({
      key: 'cashFlows',
      label: list(
        filters.cashFlows.map((value) => CASH_FLOW_LABELS[value]),
        'kinds',
      ),
    });
  if (filters.bankAccountIds?.length)
    chips.push({
      key: 'bankAccountIds',
      label: list(
        accounts
          .filter((account) => filters.bankAccountIds!.includes(account.id))
          .map((account) => (needsAccountName(account) ? account.label : account.bankName)),
        'accounts',
      ),
    });
  if (filters.categorySources?.length)
    chips.push({
      key: 'categorySources',
      label: list(
        filters.categorySources.map((value) => formatBankTransactionCategorySource(value) ?? value),
        'sources',
      ),
    });
  if (filters.baseAmount)
    chips.push({
      key: 'baseAmount',
      label: filters.baseAmount === 'MISSING' ? 'No base amount yet' : 'Has base amount',
    });
  if (filters.categoryStatuses?.length)
    chips.push({
      key: 'categoryStatuses',
      label: filters.categoryStatuses.map((value) => CATEGORY_STATUS_LABELS[value]).join(' or '),
    });
  if (filters.recurringSeriesKey)
    chips.push({key: 'recurringSeriesKey', label: 'One recurring payment'});
  if (filters.merchantGroup) chips.push({key: 'merchantGroup', label: 'One merchant'});
  if (filters.incomeSource) chips.push({key: 'incomeSource', label: 'One income source'});

  return chips;
}
