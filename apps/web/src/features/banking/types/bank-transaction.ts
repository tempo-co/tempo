import {z} from 'zod';

import {paginationSearchParamsSchema} from '@/types/pagination';

export enum BankTransactionSortField {
  BOOKING_DATE = 'bookingDate',
  AMOUNT = 'amount',
  CATEGORY = 'category',
  SOURCE = 'source',
}

export enum BankTransactionSortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export enum BankTransactionDirection {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
  UNKNOWN = 'UNKNOWN',
}

export const BANK_TRANSACTION_CATEGORIES = [
  'HOUSING_AND_UTILITIES',
  'FOOD_AND_DRINK',
  'TRANSPORTATION',
  'SHOPPING',
  'SUBSCRIPTIONS',
  'HEALTH',
  'TRAVEL',
  'ENTERTAINMENT',
  'PERSONAL_CARE',
  'EDUCATION',
  'INSURANCE',
  'TAXES',
  'FEES',
  'CASH_WITHDRAWAL',
  'INCOME',
  'REFUND',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'NEEDS_REVIEW',
  'OTHER',
] as const;

export type BankTransactionCategory = (typeof BANK_TRANSACTION_CATEGORIES)[number];

export const BANK_TRANSACTION_UNCATEGORIZED = 'UNCATEGORIZED' as const;
export const BANK_TRANSACTION_CATEGORY_FILTER_VALUES = [
  ...BANK_TRANSACTION_CATEGORIES,
  BANK_TRANSACTION_UNCATEGORIZED,
] as const;
export type BankTransactionCategoryFilterValue =
  (typeof BANK_TRANSACTION_CATEGORY_FILTER_VALUES)[number];

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
  TAXES: 'Taxes',
  FEES: 'Fees',
  CASH_WITHDRAWAL: 'Cash withdrawal',
  INCOME: 'Income',
  REFUND: 'Refund',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
  NEEDS_REVIEW: 'Needs review',
  OTHER: 'Other',
};

export const BANK_TRANSACTION_CATEGORIZATION_STATUSES = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;

export type BankTransactionCategorizationStatus =
  (typeof BANK_TRANSACTION_CATEGORIZATION_STATUSES)[number];

export const BANK_TRANSACTION_CATEGORIZATION_SOURCES = ['AI', 'MANUAL'] as const;

export type BankTransactionCategorizationSource =
  (typeof BANK_TRANSACTION_CATEGORIZATION_SOURCES)[number];

const toDate = (value: unknown) => (typeof value === 'string' ? new Date(value) : value);

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
  search: z.string().max(100).optional(),
  transactionId: z.string().optional(),
  sort: z
    .object({
      by: z.nativeEnum(BankTransactionSortField),
      order: z.nativeEnum(BankTransactionSortOrder),
    })
    .optional(),
});

export type BankTransactionSearchParams = z.infer<typeof bankTransactionSearchParamsSchema>;

export type BankTransactionFilterParams = Pick<
  BankTransactionSearchParams,
  'bookingDate' | 'bankAccountIds' | 'categories' | 'categorySources' | 'search'
>;

export type BankTransactionSortParams = BankTransactionSearchParams['sort'];

export const DEFAULT_BANK_TRANSACTION_SORT: NonNullable<BankTransactionSortParams> = {
  by: BankTransactionSortField.BOOKING_DATE,
  order: BankTransactionSortOrder.DESC,
};

export type BankTransactionCategorizationFields = {
  category: BankTransactionCategory | null;
  categoryStatus: BankTransactionCategorizationStatus;
  categorySource: BankTransactionCategorizationSource | null;
  categoryConfidence: string | null;
};

export type BankTransaction = BankTransactionCategorizationFields & {
  id: string;
  transactionDate: string | null;
  bookingDate: string | null;
  valueDate: string | null;
  description: string | null;
  displayDescription?: string | null;
  counterpartyName: string | null;
  amount: string;
  currency: string;
  creditDebitIndicator: string | null;
  direction: BankTransactionDirection;
  transactionType: string;
  transactionStatus: string | null;
  providerTransactionDescription: string | null;
  merchantCategoryCode: string | null;
  remittanceInformation: string | null;
  balanceAfterAmount: string | null;
  balanceAfterCurrency: string | null;
  instructedAmount: string | null;
  instructedCurrency: string | null;
  exchangeRate: string | null;
  exchangeRateUnitCurrency: string | null;
  exchangeRateType: string | null;
  referenceNumber: string | null;
  referenceNumberScheme: string | null;
  bankName: string;
  bankCountry: string;
  bankAccountName: string | null;
  bankAccountAlias: string | null;
};

export type BankTransactionsResponse = {
  transactions: BankTransaction[];
  total: number;
};
