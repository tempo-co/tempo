import type {BankConnection, BankImportSummary} from '@tempo/contracts';

import {MOCK_CONNECTION} from './bank-connection.data';

let next = 0x600;

/** An import of one synthetic statement file into `accountId`, nothing left to check; each call gets its own id. */
export function bankImport(
  accountId: string,
  fields: Partial<BankImportSummary> = {},
): BankImportSummary {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-000000000${next.toString(16)}`,
    bankId: null,
    format: 'camt053',
    layout: null,
    filesCount: 1,
    rowsParsed: 31,
    rowsAdded: 31,
    rowsAlreadyPresent: 0,
    rowsMatchedByReference: 0,
    rowsMatchedByBalance: 0,
    rowsMatchedByDate: 0,
    rowsDoubtful: 0,
    rowsNotInBank: 0,
    rowsRemovedBySync: 0,
    dateFrom: '2026-10-01',
    dateTo: '2026-11-20',
    accounts: [{id: accountId, name: null, currency: 'EUR', created: false}],
    accountsWithoutBalance: [],
    statementGaps: [],
    undoneAt: null,
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

/** The owner's imported-files connection, holding the given accounts. */
export function importedFiles(bankAccounts: BankConnection['bankAccounts']): BankConnection {
  return {
    ...MOCK_CONNECTION,
    id: '00000000-0000-4000-8000-000000000400',
    provider: 'file',
    aspspName: 'Imported files',
    aspspCountry: 'ZZ',
    consentValidUntil: null,
    lastSyncedAt: null,
    lastSuccessfulSyncAt: null,
    nextSyncAt: null,
    syncStatus: 'IDLE',
    bankAccounts,
  };
}
