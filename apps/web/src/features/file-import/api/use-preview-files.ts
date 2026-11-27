import {useMutation} from '@tanstack/react-query';
import type {BankImportPreview} from '@wisp/contracts';

import {api} from '@/utils/api';

import {type ImportFilesRequest, dropForm} from './use-import-files';

/** Reads one drop without importing it: the accounts it would go to, with their rows' count and days. */
export function usePreviewFiles() {
  const {mutateAsync} = useMutation({
    mutationFn: (request: ImportFilesRequest) =>
      api.post<BankImportPreview>('/bank-imports/preview', dropForm(request)),
  });
  return {previewFiles: mutateAsync};
}
