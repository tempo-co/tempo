import type {BankImportSummary} from '@tempo/contracts';
import {toast} from 'sonner';

import {HttpError, wasToasted} from '@/utils/api';

import {useUndoBankImport} from '../api/use-undo-bank-import';
import {undoDescription} from '../utils/import-format';
import {useKnownAccounts} from './use-known-accounts';

/** Undoing an import from its row or its summary: the confirmation's copy, the request and its outcome toast. */
export function useUndoImport() {
  const {undoBankImport, isPending} = useUndoBankImport();
  const known = useKnownAccounts();

  const describe = (summary: BankImportSummary) =>
    undoDescription(summary, {
      intoSyncedAccount: summary.accounts.some((account) => known.get(account.id)?.synced),
    });

  /** Whether the import is undone now, also when another tab undid it first. */
  const undo = async (summary: BankImportSummary) => {
    try {
      await undoBankImport(summary.id);
      toast.success('Import undone', {id: `bank-import-undone-${summary.id}`});
      return true;
    } catch (error) {
      if (wasToasted(error)) return false;
      // The API only finds imports that are not undone yet.
      if (error instanceof HttpError && error.status === 404) {
        toast.info('This import was already undone', {id: `bank-import-undone-${summary.id}`});
        return true;
      }
      toast.error("Couldn't undo the import", {
        description: 'Please try again in a moment.',
        id: `bank-import-undo-failed-${summary.id}`,
      });
      return false;
    }
  };

  return {undo, describe, isPending};
}
