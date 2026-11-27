import type {BankImportSummary} from '@wisp/contracts';
import {toast} from 'sonner';

import {HttpError, wasToasted} from '@/utils/api';

import {useUndoBankImport} from '../api/use-undo-bank-import';
import {undoDescription} from '../utils/import-format';
import {useKnownAccounts} from './use-known-accounts';

export const UNDO_FAILED = "Couldn't undo the import";

/** Undoing an import from its row or its summary: the confirmation's copy, the request and its outcome toast. */
export function useUndoImport() {
  const {undoBankImport, isPending} = useUndoBankImport();
  const known = useKnownAccounts();

  const describe = (summary: BankImportSummary) =>
    undoDescription(summary, {
      intoSyncedAccount: summary.accounts.some((account) => known.get(account.id)?.synced),
    });

  /** Undoes the import, also when another tab undid it first, with its toast; a failure is thrown. */
  const undoOrThrow = async (summary: BankImportSummary) => {
    try {
      await undoBankImport(summary.id);
      toast.success('Import undone', {id: `bank-import-undone-${summary.id}`});
    } catch (error) {
      // The API only finds imports that are not undone yet.
      if (!(error instanceof HttpError && error.status === 404)) throw error;
      toast.info('This import was already undone', {id: `bank-import-undone-${summary.id}`});
    }
  };

  /** Whether the import is undone now; a failure is a toast. */
  const undo = async (summary: BankImportSummary) => {
    try {
      await undoOrThrow(summary);
      return true;
    } catch (error) {
      if (!wasToasted(error))
        toast.error(UNDO_FAILED, {
          description: 'Try again in a moment.',
          id: `bank-import-undo-failed-${summary.id}`,
        });
      return false;
    }
  };

  return {undo, undoOrThrow, describe, isPending};
}
