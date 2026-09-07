import {z} from 'zod';

import {paginationSearchParamsSchema} from '@/types/pagination';

export enum BankTransactionSortField {
  BOOKING_DATE = 'bookingDate',
  AMOUNT = 'amount',
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

const toDate = (value: unknown) => (typeof value === 'string' ? new Date(value) : value);

export const bankTransactionSearchParamsSchema = paginationSearchParamsSchema.extend({
  bookingDate: z
    .object({
      from: z.preprocess(toDate, z.date()).optional(),
      to: z.preprocess(toDate, z.date()).optional(),
    })
    .optional(),
  bankAccountIds: z.array(z.string().uuid()).optional(),
  search: z.string().max(100).optional(),
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
  'bookingDate' | 'bankAccountIds' | 'search'
>;

export type BankTransactionSortParams = BankTransactionSearchParams['sort'];

export const DEFAULT_BANK_TRANSACTION_SORT: NonNullable<BankTransactionSortParams> = {
  by: BankTransactionSortField.BOOKING_DATE,
  order: BankTransactionSortOrder.DESC,
};

export type BankTransaction = {
  id: string;
  transactionDate: string | null;
  bookingDate: string | null;
  valueDate: string | null;
  description: string | null;
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
