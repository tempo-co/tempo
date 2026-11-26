import {createContext, useContext} from 'react';

import type {
  FileImportController,
  ImportStep,
} from '@/features/file-import/components/use-file-import';

export type ConnectResult = 'connected' | 'cancelled' | 'error';

export type AddData = {
  /** Add data in the sidebar or the phone header: the ways in, or straight to the one there is. */
  openMenu: () => void;
  /** Import a file: the import's steps, fresh unless an import is unsettled. */
  openImport: () => void;
  /** Connect a bank: its bank list. */
  openConnect: () => void;
  /** An import's summary or rows to check, as from the Imports list. */
  showImport: (step: ImportStep) => void;
  /** The bank's return to Accounts: a toast when it connected, else the sheet says what happened. */
  connectReturned: (result: ConnectResult) => void;
  /** Whether this deployment imports files; false until the import list says so. */
  importOn: boolean;
  /** The import's state, for pages that show what it is doing. */
  fileImport: FileImportController;
  /** A hand-off to a bank is starting. */
  isStarting: boolean;
};

export const AddDataContext = createContext<AddData | null>(null);

/** Add data's one sheet, opened from any signed-in page. */
export function useAddData() {
  const addData = useContext(AddDataContext);
  if (!addData) throw new Error('useAddData needs the AddDataProvider of the signed-in shell');
  return addData;
}
