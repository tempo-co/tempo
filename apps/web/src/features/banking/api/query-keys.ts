import type {
  BankTransactionFilterParams,
  BankTransactionSortParams,
} from '../types/bank-transaction';

export const bankQueryKeys = {
  connections: ['bank-connections'] as const,
  supportedBanks: ['supported-banks'] as const,
  connectedBankLogos: ['connected-bank-logos'] as const,
  transaction: (id: string) => ['bank-transaction', id] as const,
  transactionRoot: ['bank-transaction'] as const,
  /** The Transactions page's list: every page loaded so far. Filters sit at index 2 for cache updates. */
  transactions: (filters: BankTransactionFilterParams, sort: BankTransactionSortParams) =>
    ['bank-transactions', 'ledger', filters, sort] as const,
  transactionsRoot: ['bank-transactions'] as const,
  /** The reporting currency: whether the owner is asked to choose one depends on their accounts and history. */
  reportingCurrency: ['reporting-currency'] as const,
};
