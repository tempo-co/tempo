import {useMutation} from '@tanstack/react-query';
import {BankTransactionCategory} from '@tempo/contracts';

import {api} from '@/utils/api';

import {BankTransaction, BankTransactionCategoryImpact} from '../types/bank-transaction';

type PreviewBankTransactionCategoryInput = {
  id: BankTransaction['id'];
  category: BankTransactionCategory;
};

/**
 * Which of the owner's other rows a correction would change. A mutation rather than a query: it is
 * read fresh for every correction and never retried or kept, an expired session signs out as on any
 * other request, and its callbacks never run after the inspector closes.
 */
export const usePreviewBankTransactionCategory = () => {
  const {mutate, isPending} = useMutation<
    BankTransactionCategoryImpact,
    Error,
    PreviewBankTransactionCategoryInput
  >({
    mutationFn: ({id, category}) =>
      api.get<BankTransactionCategoryImpact>(
        `/bank-transactions/${id}/category-impact?${new URLSearchParams({category})}`,
      ),
  });

  return {previewBankTransactionCategory: mutate, isPending};
};
