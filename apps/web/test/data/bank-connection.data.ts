import type {BankConnection} from '@tempo/contracts';

import type {BankSyncRun} from '../../src/features/banking/types/bank-sync-run';
import {successfulBankRefresh} from './bank-sync-run.data';

export const TARGET_ASPSP = {name: 'Mock ASPSP', country: 'NL'};
export const MOCK_CONNECTION: BankConnection = {
  id: '00000000-0000-4000-8000-000000000096',
  provider: 'enable-banking',
  aspspName: TARGET_ASPSP.name,
  aspspCountry: TARGET_ASPSP.country,
  status: 'AUTHORIZED',
  consentValidUntil: '2030-01-01T00:00:00.000Z',
  lastSyncedAt: null,
  lastSyncError: null,
  nextSyncAt: '2030-01-01T00:00:00.000Z',
  syncStatus: 'SUCCEEDED',
  baseCurrency: 'EUR',
  bankAccounts: [
    {
      id: '00000000-0000-4000-8000-000000000097',
      name: 'Mock current account',
      details: 'Mock ASPSP checking account',
      alias: null,
      currency: 'EUR',
      cashAccountType: 'CACC',
      usage: 'PRIV',
      maskedIdentifier: '****1234',
      currentBalanceAmount: '1234.56',
      currentBalanceType: 'AVAILABLE',
      balanceUpdatedAt: null,
      currentBalanceInBaseCurrency: null,
      baseCurrencyRateDate: null,
      isActive: true,
      latestBalances: [],
    },
    {
      id: '00000000-0000-4000-8000-000000000098',
      name: 'Mock savings account',
      details: 'Mock ASPSP savings account',
      alias: null,
      currency: 'EUR',
      cashAccountType: 'SVGS',
      usage: 'PRIV',
      maskedIdentifier: '****5678',
      currentBalanceAmount: '100.44',
      currentBalanceType: 'AVAILABLE',
      balanceUpdatedAt: null,
      currentBalanceInBaseCurrency: null,
      baseCurrencyRateDate: null,
      isActive: true,
      latestBalances: [],
    },
  ],
};

export const REFRESH_RESULT = {
  ...successfulBankRefresh,
  transactionsAdded: 3,
} satisfies BankSyncRun;
