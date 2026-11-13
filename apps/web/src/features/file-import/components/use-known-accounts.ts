import {useQuery} from '@tanstack/react-query';
import type {BankImportSummary} from '@tempo/contracts';
import {useMemo} from 'react';

import {bankConnectionsQueryOptions} from '@/features/banking/api/use-get-all-bank-connections';
import {accountName} from '@/features/banking/utils/bank-account-name';
import {isFileConnection} from '@/features/banking/utils/bank-sync-status';

export type KnownAccount = {name: string; synced: boolean};

/**
 * The owner's accounts by id, as the Connections page names them, read from the loaded connection list. An
 * import's summary names an account only by its provider name, which is often just the holder's name.
 */
export function useKnownAccounts() {
  const {data: connections} = useQuery({...bankConnectionsQueryOptions, enabled: false});
  return useMemo(() => {
    const accounts = new Map<string, KnownAccount>();
    for (const connection of connections ?? []) {
      for (const account of connection.bankAccounts)
        accounts.set(account.id, {
          name: accountName(account),
          synced: !isFileConnection(connection),
        });
    }
    return accounts;
  }, [connections]);
}

export function importAccountName(
  account: Pick<BankImportSummary['accounts'][number], 'id' | 'name' | 'currency'>,
  known: Map<string, KnownAccount>,
) {
  return known.get(account.id)?.name ?? account.name ?? `${account.currency} account`;
}
