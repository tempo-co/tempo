import {type ReactNode, Suspense, lazy, useCallback, useMemo, useRef, useState} from 'react';
import {toast} from 'sonner';

import {takeConnectingBank, useConnectBank} from '@/features/accounts/api/use-connect-bank';
import type {ConnectingBank} from '@/features/banking/components/connect-bank-steps';
import {useBankImports} from '@/features/file-import/api/use-bank-imports';
import {PageFileDrop} from '@/features/file-import/components/page-file-drop';
import type {ImportStep} from '@/features/file-import/components/use-file-import';

import {
  type AddData,
  type AddDataAsk,
  AddDataContext,
  type ConnectResult,
  type Opener,
  type SheetState,
  useAddData,
} from '../use-add-data';
import type {SheetHandle} from './add-data-sheet';

// The sheet holds the import's steps and the bank list, so it loads only once Add data is first asked for.
const AddDataSheet = lazy(() =>
  import('./add-data-sheet').then((module) => ({default: module.AddDataSheet})),
);

/**
 * Add data for the signed-in shell: the actions every page calls, and files dropped on any page. The sheet itself
 * (along the right edge on desktop, a bottom sheet on phones) loads on first use and then stays mounted, so an
 * import keeps going while it is closed or the owner moves to another page.
 */
export function AddDataProvider({children}: {children: ReactNode}) {
  const imports = useBankImports();
  const importOn = imports.state === 'on';
  const {connect, isStarting} = useConnectBank();
  // Mounted from the first ask on, then kept, so the sheet can animate closed and an import keeps its state.
  const [wanted, setWanted] = useState(false);
  const [sheet, setSheet] = useState<SheetState>({open: false, busy: false});
  const sheetRef = useRef<SheetHandle | null>(null);
  // The ask made while the sheet was still loading, answered as it arrives. A drop's files wait here, and a later
  // ask does not replace them: the sheet opens at their import either way.
  const pending = useRef<AddDataAsk | null>(null);
  // Where focus goes back to when the sheet closes, since it opens from many places.
  const openerRef = useRef<HTMLElement | null>(null);
  // A second report of the same return (React's development double run) keeps the bank the first one read.
  const returnedBank = useRef<ConnectingBank | null>(null);

  const ask = useCallback((next: AddDataAsk, event?: Opener) => {
    // From the click, not the focused element: Safari on iPhone does not focus a tapped button.
    openerRef.current = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (sheetRef.current) return sheetRef.current.answer(next);
    if (pending.current?.kind !== 'drop') pending.current = next;
    setWanted(true);
  }, []);
  // The loaded sheet takes the ask that waited for it.
  const attach = useCallback((handle: SheetHandle | null) => {
    sheetRef.current = handle;
    const waiting = pending.current;
    if (!handle || !waiting) return;
    pending.current = null;
    handle.answer(waiting);
  }, []);

  // The same actions from render to render, so a page's effect that calls one runs once.
  const actions = useMemo(
    () => ({
      openMenu: (event?: Opener) => ask({kind: 'menu'}, event),
      openImport: (event?: Opener) => ask({kind: 'import'}, event),
      openConnect: (event?: Opener) => ask({kind: 'connect'}, event),
      showImport: (step: ImportStep, event?: Opener) => ask({kind: 'show', step}, event),
      connectReturned: (result: ConnectResult) => {
        const bank = takeConnectingBank() ?? returnedBank.current;
        returnedBank.current = bank;
        if (result === 'connected') {
          toast.success('Bank connection added', {id: 'bank-connection-success'});
          return;
        }
        ask({kind: 'returned', result, bank});
      },
      importDropped: (files: File[]) => ask({kind: 'drop', files}),
    }),
    [ask],
  );
  const value = useMemo<AddData>(
    () => ({
      ...actions,
      // One import at a time: a drop waits until the running one has answered.
      dropEnabled: !sheet.open && !sheet.busy,
      importOn,
      isStarting,
    }),
    [actions, importOn, isStarting, sheet],
  );

  return (
    <AddDataContext.Provider value={value}>
      {children}
      {wanted && (
        <Suspense fallback={null}>
          <AddDataSheet
            ref={attach}
            openerRef={openerRef}
            importOn={importOn}
            onConnect={connect}
            isStarting={isStarting}
            onState={setSheet}
          />
        </Suspense>
      )}
    </AddDataContext.Provider>
  );
}

/**
 * Files dragged anywhere over the page column import in the Add data sheet, while file import is on, the sheet is
 * closed and no import is running. A drop before the sheet has loaded waits for it.
 */
export function AddDataDrop() {
  const {importOn, dropEnabled, importDropped} = useAddData();
  if (!importOn) return null;
  return <PageFileDrop enabled={dropEnabled} onFiles={importDropped} />;
}
