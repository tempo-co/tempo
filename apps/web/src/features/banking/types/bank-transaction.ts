import {
  BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES,
  BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES,
  BANK_TRANSACTION_CATEGORIZATION_SOURCES,
  BANK_TRANSACTION_CATEGORY_FILTER_VALUES,
  BANK_TRANSACTION_CATEGORY_STATUS_FILTER_VALUES,
  BANK_TRANSACTION_FINANCIAL_EVENT_FILTER_VALUES,
  BANK_TRANSACTION_SEARCH_MAX_LENGTH,
  BANK_TRANSACTION_SORT_FIELDS,
  type BankTransaction,
  type BankTransactionCategory,
  type BankTransactionFinancialEventFilterValue,
  type BankTransactionFinancialEventType,
  SORT_ORDERS,
} from '@tempo/contracts';
import {z} from 'zod';

import {paginationSearchParamsSchema} from '@/types/pagination';

/** The activity part of the cash-flow filter, in picker order. */
export const BANK_TRANSACTION_ACTIVITY_FILTER_VALUES =
  BANK_TRANSACTION_FINANCIAL_EVENT_FILTER_VALUES;
export type BankTransactionActivityFilterValue = BankTransactionFinancialEventFilterValue;

export const BANK_TRANSACTION_FINANCIAL_EVENT_LABELS: Record<
  BankTransactionFinancialEventType,
  string
> = {
  CURRENCY_EXCHANGE: 'Currency exchange',
};

export const BANK_TRANSACTION_ACTIVITY_LABELS: Record<BankTransactionActivityFilterValue, string> =
  {
    ...BANK_TRANSACTION_FINANCIAL_EVENT_LABELS,
    OWN_TRANSFER: 'Own transfer',
  };

export const BANK_TRANSACTION_CATEGORY_LABELS: Record<BankTransactionCategory, string> = {
  HOUSING_AND_UTILITIES: 'Housing and utilities',
  FOOD_AND_DRINK: 'Food and drink',
  TRANSPORTATION: 'Transportation',
  SHOPPING: 'Shopping',
  SUBSCRIPTIONS: 'Subscriptions',
  HEALTH: 'Health',
  TRAVEL: 'Travel',
  ENTERTAINMENT: 'Entertainment',
  PERSONAL_CARE: 'Personal care',
  EDUCATION: 'Education',
  INSURANCE: 'Insurance',
  FEES: 'Fees',
  CASH_WITHDRAWAL: 'Cash withdrawal',
  INCOME: 'Income',
  REFUND: 'Refund',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
  NEEDS_REVIEW: 'Needs review',
  OTHER: 'Other',
};

/** The two kinds of internal movement in the cash-flow filter. */
export const BANK_TRANSACTION_INTERNAL_MOVEMENT_KINDS = [
  'CURRENCY_EXCHANGE',
  'OWN_TRANSFER',
] as const;
const toDate = (value: unknown) => (typeof value === 'string' ? new Date(value) : value);

/** A recurring series' key: 32 lowercase hex characters. */
export const recurringSeriesKeySchema = z.string().regex(/^[0-9a-f]{32}$/);

export const bankTransactionSearchParamsSchema = paginationSearchParamsSchema.extend({
  bookingDate: z
    .object({
      from: z.preprocess(toDate, z.date()).optional(),
      to: z.preprocess(toDate, z.date()).optional(),
    })
    .optional(),
  bankAccountIds: z.array(z.string().uuid()).optional(),
  categories: z.array(z.enum(BANK_TRANSACTION_CATEGORY_FILTER_VALUES)).optional(),
  categorySources: z.array(z.enum(BANK_TRANSACTION_CATEGORIZATION_SOURCES)).optional(),
  cashFlows: z
    .array(z.enum(BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES))
    .transform((values) => {
      const allInternal =
        values.includes('INTERNAL') ||
        BANK_TRANSACTION_INTERNAL_MOVEMENT_KINDS.every((kind) => values.includes(kind));
      return BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES.filter((value) =>
        value === 'INTERNAL'
          ? allInternal
          : (BANK_TRANSACTION_INTERNAL_MOVEMENT_KINDS as readonly string[]).includes(value)
            ? !allInternal && values.includes(value)
            : values.includes(value),
      );
    })
    .optional(),
  baseAmount: z.enum(BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES).optional(),
  categoryStatuses: z.array(z.enum(BANK_TRANSACTION_CATEGORY_STATUS_FILTER_VALUES)).optional(),
  search: z.string().max(BANK_TRANSACTION_SEARCH_MAX_LENGTH).optional(),
  /** Only the payments of one recurring series, from the recurring payments list. */
  recurringSeriesKey: recurringSeriesKeySchema.optional(),
  transactionId: z.string().optional(),
  sort: z
    .object({
      by: z.enum(BANK_TRANSACTION_SORT_FIELDS),
      order: z.enum(SORT_ORDERS),
    })
    .optional(),
});

export type BankTransactionSearchParams = z.infer<typeof bankTransactionSearchParamsSchema>;

/**
 * The route schema. It also accepts `financialEventTypes`, which older shared links use for the cash-flow filter,
 * and merges its values into `cashFlows` so those links filter the same rows.
 */
export const bankTransactionRouteSearchSchema = z.preprocess((search) => {
  if (!search || typeof search !== 'object' || !('financialEventTypes' in search)) return search;
  const {financialEventTypes, ...rest} = search as Record<string, unknown>;
  const legacy: unknown[] = Array.isArray(financialEventTypes) ? financialEventTypes : [];
  const current: unknown[] = Array.isArray(rest.cashFlows) ? rest.cashFlows : [];
  const cashFlows = [...new Set([...current, ...legacy])];
  return cashFlows.length > 0 ? {...rest, cashFlows} : rest;
}, bankTransactionSearchParamsSchema) as unknown as typeof bankTransactionSearchParamsSchema;

/** The search params that filter the transaction list; `search` is the free-text query. */
export const BANK_TRANSACTION_FILTER_KEYS = [
  'bookingDate',
  'bankAccountIds',
  'categories',
  'categorySources',
  'cashFlows',
  'baseAmount',
  'categoryStatuses',
  'recurringSeriesKey',
  'search',
] as const satisfies readonly (keyof BankTransactionSearchParams)[];

export type BankTransactionFilterParams = Pick<
  BankTransactionSearchParams,
  (typeof BANK_TRANSACTION_FILTER_KEYS)[number]
>;

export type BankTransactionSortParams = BankTransactionSearchParams['sort'];

export const DEFAULT_BANK_TRANSACTION_SORT: NonNullable<BankTransactionSortParams> = {
  by: 'bookingDate',
  order: 'DESC',
};

export type BankTransactionCategorizationFields = Pick<
  BankTransaction,
  'category' | 'categoryStatus' | 'categorySource' | 'categoryConfidence'
>;

/** Shared by list rows and connection summaries; summaries omit the currency-exchange counterpart. */
export type BankTransactionFinancialEventFields = Pick<
  BankTransaction,
  'financialEventType' | 'financialEventSource' | 'financialEventRuleVersion' | 'cashFlowTreatment'
> &
  Partial<Pick<BankTransaction, 'currencyExchangeCounterpart'>>;

/** Absent on connection summaries, which only carry the treatment. */
export type BankTransactionOwnTransferFields = Partial<
  Pick<BankTransaction, 'ownTransfer' | 'ownTransferOverride'>
>;
