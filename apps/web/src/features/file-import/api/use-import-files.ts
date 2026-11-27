import {useMutation, useQueryClient} from '@tanstack/react-query';
import type {BankImportSummary} from '@tempo/contracts';

import {api} from '@/utils/api';

import type {PickedBankId} from '../utils/picked-bank';
import {invalidateAfterImportChange, storeImportSummary} from './use-bank-imports';

export type ImportFilesRequest = {
  files: readonly File[];
  /** Answers to the API's account questions, by `<bank>:<currency>`: an account id or `new`. */
  accountChoices?: Record<string, string>;
  /** The bank the owner picked for the drop (`BankImportPickedBank`), when they picked one. */
  bankId?: PickedBankId;
};

/** Sends one drop. It is all or nothing: a refusal writes nothing. */
export function useImportFiles() {
  const queryClient = useQueryClient();
  const {mutateAsync, isPending} = useMutation({
    mutationFn: ({files, accountChoices, bankId}: ImportFilesRequest) => {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      if (accountChoices) form.append('accountChoices', JSON.stringify(accountChoices));
      if (bankId) form.append('bankId', bankId);
      return api.post<BankImportSummary>('/bank-imports', form);
    },
    onSuccess: (summary) => {
      storeImportSummary(queryClient, summary);
      void invalidateAfterImportChange(queryClient);
    },
  });
  return {importFiles: mutateAsync, isPending};
}
