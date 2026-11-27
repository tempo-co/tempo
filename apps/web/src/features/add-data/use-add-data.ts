import {createContext, useContext} from 'react';

import type {ConnectingBank} from '@/features/banking/components/connect-bank-steps';
import type {ImportStep} from '@/features/file-import/components/use-file-import';

export type ConnectResult = 'connected' | 'cancelled' | 'error';

/** The click that opens the sheet: focus goes back to its button when the sheet closes. */
export type Opener = {currentTarget: EventTarget | null};

/** What the shell asks of the Add data sheet, which loads only once it is first asked. */
export type AddDataAsk =
  | {kind: 'menu'}
  | {kind: 'import'}
  | {kind: 'connect'}
  | {kind: 'show'; step: ImportStep}
  /** Files dropped on the page, handed to the sheet's import as it loads. */
  | {kind: 'drop'; files: File[]}
  | {kind: 'returned'; result: 'cancelled' | 'error'; bank: ConnectingBank | null};

/** What the loaded sheet reports back: whether it is open, and whether an import is running. */
export type SheetState = {open: boolean; busy: boolean};

export type AddData = {
  /** Add data in the sidebar or the phone header: the ways in, or straight to the one there is. */
  openMenu: (opener?: Opener) => void;
  /** Import a file: the import's steps, fresh unless an import is unsettled. */
  openImport: (opener?: Opener) => void;
  /** Connect a bank: its bank list. */
  openConnect: (opener?: Opener) => void;
  /** An import's summary or rows to check, as from the Imports list. */
  showImport: (step: ImportStep, opener?: Opener) => void;
  /** The bank's return to Accounts: a toast when it connected, else the sheet says what happened. */
  connectReturned: (result: ConnectResult) => void;
  /** Whether this deployment imports files; false until the import list says so. */
  importOn: boolean;
  /** A hand-off to a bank is starting. */
  isStarting: boolean;
  /** Whether a drop on the page imports now: the sheet is closed and no import is running. */
  dropEnabled: boolean;
  /** Files dropped on the page: the sheet opens at the import and imports them. */
  importDropped: (files: File[]) => void;
  /**
   * The empty Home says it is shown (`true`) and gone (`false`): while it is, Add data opens as the first run, a
   * centred dialog whose import closes on the filled Home.
   */
  setFirstRun: (shown: boolean) => void;
};

export const AddDataContext = createContext<AddData | null>(null);

/** Add data's one sheet, opened from any signed-in page. */
export function useAddData() {
  const addData = useContext(AddDataContext);
  if (!addData) throw new Error('useAddData needs the AddDataProvider of the signed-in shell');
  return addData;
}
