import {
  BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES,
  BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES,
  BANK_TRANSACTION_CATEGORIZATION_SOURCES,
  BANK_TRANSACTION_CATEGORY_FILTER_VALUES,
  BANK_TRANSACTION_CATEGORY_STATUS_FILTER_VALUES,
  BANK_TRANSACTION_FINANCIAL_EVENT_FILTER_VALUES,
  BANK_TRANSACTION_SEARCH_MAX_LENGTH,
  type BankTransaction,
  type BankTransactionCategory,
  type BankTransactionFinancialEventFilterValue,
  type BankTransactionFinancialEventType,
  type BankTransactionSortField,
  MERCHANT_GROUP_ID_PATTERN,
  SORT_ORDERS,
} from '@tempo/contracts';
import {z} from 'zod';

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
  HOME_IMPROVEMENT: 'Home improvement',
  GROCERIES: 'Groceries',
  EATING_OUT: 'Eating out',
  TRANSPORTATION: 'Transportation',
  SHOPPING: 'Shopping',
  HEALTH: 'Health and fitness',
  PERSONAL_CARE: 'Personal care',
  ENTERTAINMENT: 'Entertainment',
  TRAVEL: 'Travel',
  SERVICES: 'Services',
  EDUCATION: 'Education',
  INSURANCE: 'Insurance',
  LOANS_AND_DEBT: 'Loans and debt',
  FEES: 'Fees',
  TAXES_AND_GOVERNMENT: 'Taxes and government',
  GIFTS_AND_DONATIONS: 'Gifts and donations',
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

export const bankTransactionSearchParamsSchema = z.object({
  date: z
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
  /** Only one merchant group's rows, from a merchant page. */
  merchantGroup: z.string().regex(new RegExp(MERCHANT_GROUP_ID_PATTERN)).optional(),
  /** Only one income source's rows, by its breakdown key, from Home. */
  incomeSource: z.string().max(BANK_TRANSACTION_SEARCH_MAX_LENGTH).optional(),
  /** Only the rows the nav badge counts: to review or failed to categorize. */
  needsAttention: z.literal(true).optional(),
  transactionId: z.string().optional(),
  /** The orders the page offers; an older link's category or source order falls back to newest first. */
  sort: z
    .object({
      by: z.enum(['date', 'amount'] as const satisfies readonly BankTransactionSortField[]),
      order: z.enum(SORT_ORDERS),
    })
    .optional()
    .catch(undefined),
});

export type BankTransactionSearchParams = z.infer<typeof bankTransactionSearchParamsSchema>;

/** The search params that filter the transaction list; `search` is the free-text query. */
export const BANK_TRANSACTION_FILTER_KEYS = [
  'date',
  'bankAccountIds',
  'categories',
  'categorySources',
  'cashFlows',
  'baseAmount',
  'categoryStatuses',
  'recurringSeriesKey',
  'merchantGroup',
  'incomeSource',
  'needsAttention',
  'search',
] as const satisfies readonly (keyof BankTransactionSearchParams)[];

export type BankTransactionFilterParams = Pick<
  BankTransactionSearchParams,
  (typeof BANK_TRANSACTION_FILTER_KEYS)[number]
>;

export type BankTransactionSortParams = BankTransactionSearchParams['sort'];

export const DEFAULT_BANK_TRANSACTION_SORT: NonNullable<BankTransactionSortParams> = {
  by: 'date',
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
