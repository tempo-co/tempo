import type {
  BankTransaction,
  BankTransactionCategorizationFields,
  BankTransactionFinancialEventFields,
} from './bank-transaction';

export type BankConnectionAuthorizationRequest = {
  aspspName: string;
  aspspCountry: string;
};

export type BankConnectionAspsp = {
  name: string;
  country: string;
  logoUrl?: string;
};

export type BankConnectionAuthorizationResponse = {
  authorizationUrl: string;
};

export type BankAccount = {
  id: string;
  name: string | null;
  details: string | null;
  alias: string | null;
  currency: string;
  cashAccountType: string | null;
  usage: string | null;
  maskedIdentifier: string | null;
  currentBalanceAmount: string | null;
  currentBalanceType: string | null;
  balanceUpdatedAt: string | null;
  isActive: boolean;
  latestBalances: BankAccountBalance[];
};

export type BankAccountBalance = {
  name: string | null;
  balanceType: string;
  amount: string;
  currency: string;
  lastChangeDateTime: string | null;
  referenceDate: string | null;
  observedAt: string;
  isPrimary: boolean;
};

export type BankConnection = {
  id: string;
  provider: string;
  aspspName: string;
  aspspCountry: string;
  status: string;
  consentValidUntil: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  nextSyncAt: string | null;
  syncStatus:
    'IDLE' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'RATE_LIMITED' | 'EXPIRED';
  bankAccounts: BankAccount[];
};

export type BankConnectionTransaction = Pick<
  BankTransaction,
  | keyof BankTransactionCategorizationFields
  | keyof BankTransactionFinancialEventFields
  | 'id'
  | 'bookingDate'
  | 'valueDate'
  | 'amount'
  | 'currency'
  | 'creditDebitIndicator'
  | 'transactionStatus'
  | 'description'
  | 'displayDescription'
  | 'counterpartyName'
  | 'merchantCategoryCode'
  | 'remittanceInformation'
>;

export type BankConnectionTransactionsResponse = {
  transactions: BankConnectionTransaction[];
  total: number;
};
