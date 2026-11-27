import {useQuery} from '@tanstack/react-query';
import type {BankImportBanks} from '@wisp/contracts';

import {api} from '@/utils/api';

import {bankImportQueryKeys} from './use-bank-imports';

/**
 * The owner's own banks to name the proposal's layout after without typing one: connected, imported and saved, sorted,
 * and only those its confirmation accepts. `enabled` is off once the proposal is being confirmed: a saved proposal has
 * no list to read.
 */
export function useBankImportBanks(proposalId: string, {enabled}: {enabled: boolean}) {
  return useQuery({
    enabled,
    queryKey: [...bankImportQueryKeys.banks, proposalId],
    // The preview step shows its own failed-load state, so the wrapper's toast would report the failure twice.
    queryFn: () =>
      api.get<BankImportBanks>(`/bank-imports/layout-proposals/${proposalId}/banks`, {
        quiet: true,
      }),
    select: ({banks}) => banks,
  });
}
