import {useMutation, useQueryClient} from '@tanstack/react-query';
import type {
  BankTransactionBulkCategoryPreview,
  BankTransactionBulkCategoryPreviewRequest,
  BankTransactionBulkCategoryResult,
  BankTransactionBulkCategoryUpdate,
} from '@tempo/contracts';

import {HttpError, api} from '@/utils/api';

import {invalidateBankDerivedData} from './invalidate-bank-derived-data';

/**
 * Which other rows from the selected rows' payees "Change all" would change. A mutation, as the single-row preview
 * is: read fresh for every pick, never retried or kept.
 */
export const usePreviewBulkCategory = () => {
  const {mutate, isPending} = useMutation<
    BankTransactionBulkCategoryPreview,
    HttpError,
    BankTransactionBulkCategoryPreviewRequest
  >({
    mutationFn: (body) =>
      api.post<BankTransactionBulkCategoryPreview>(
        '/bank-transactions/bulk-category/preview',
        body,
      ),
  });
  return {previewBulkCategory: mutate, isPending};
};

/** Gives the selected rows one category, and "all" the previewed rows too, in one write. */
export const useUpdateBulkCategory = () => {
  const queryClient = useQueryClient();
  const {mutateAsync, isPending} = useMutation<
    BankTransactionBulkCategoryResult,
    HttpError,
    BankTransactionBulkCategoryUpdate
  >({
    mutationFn: (body) =>
      api.patch<BankTransactionBulkCategoryResult>('/bank-transactions/bulk-category', body),
    // The server decides which rows changed, so every list, count and total is read again.
    onSuccess: () => invalidateBankDerivedData(queryClient),
  });
  return {updateBulkCategory: mutateAsync, isPending};
};
