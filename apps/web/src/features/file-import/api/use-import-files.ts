import {useMutation, useQueryClient} from '@tanstack/react-query';
import type {BankImportPreview, BankImportSummary} from '@tempo/contracts';

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

/** A drop as the import and its preview both take it. */
function dropForm({files, accountChoices, bankId}: ImportFilesRequest) {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  if (accountChoices) form.append('accountChoices', JSON.stringify(accountChoices));
  if (bankId) form.append('bankId', bankId);
  return form;
}

/** Reads one drop without importing it: the accounts it would go to, with their rows' count and days. */
export function usePreviewFiles() {
  const {mutateAsync} = useMutation({
    mutationFn: (request: ImportFilesRequest) =>
      api.post<BankImportPreview>('/bank-imports/preview', dropForm(request)),
  });
  return {previewFiles: mutateAsync};
}

/** Sends one drop. It is all or nothing: a refusal writes nothing. */
export function useImportFiles() {
  const queryClient = useQueryClient();
  const {mutateAsync, isPending} = useMutation({
    mutationFn: (request: ImportFilesRequest) =>
      api.post<BankImportSummary>('/bank-imports', dropForm(request)),
    onSuccess: (summary) => {
      storeImportSummary(queryClient, summary);
      void invalidateAfterImportChange(queryClient);
    },
  });
  return {importFiles: mutateAsync, isPending};
}
