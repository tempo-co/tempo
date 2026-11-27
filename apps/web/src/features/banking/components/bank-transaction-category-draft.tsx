import type {BankTransactionCategory, BankTransactionCategoryImpact} from '@wisp/contracts';
import {createContext, useContext} from 'react';

/** A category picked for a transaction whose preview found other payments it could move too. */
export type CategoryDraft = {
  category: BankTransactionCategory;
  impact: BankTransactionCategoryImpact;
};

/** Set by the details panel: a draft turns the panel into the "update other transactions" step. */
export const CategoryDraftContext = createContext<((draft: CategoryDraft) => void) | null>(null);

export function useStartCategoryDraft() {
  const start = useContext(CategoryDraftContext);
  if (!start) throw new Error('A category select needs the details panel around it.');
  return start;
}
