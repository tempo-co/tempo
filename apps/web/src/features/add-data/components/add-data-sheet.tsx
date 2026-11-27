import type {BankConnectionAspsp} from '@wisp/contracts';
import {ChevronRight, FileUp, Landmark} from 'lucide-react';
import {
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react';

import {StepFrame} from '@/components/shared/step-frame';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogCornerClose,
} from '@/components/ui/responsive-dialog';
import {ConnectBankSteps, type ConnectStep} from '@/features/banking/components/connect-bank-steps';
import {FileImportSteps} from '@/features/file-import/components/file-import-steps';
import {BUSY, isUnsettled, useFileImport} from '@/features/file-import/components/use-file-import';
import {IMPORT_TILE} from '@/features/file-import/utils/import-tile';
import {useIsMobile} from '@/hooks/use-is-mobile';

import type {AddDataAsk, SheetState} from '../use-add-data';

type View = 'menu' | 'import' | 'connect';

const BANK_LIST: ConnectStep = {kind: 'bank'};

/** How the shell asks the loaded sheet for something. */
export type SheetHandle = {answer: (ask: AddDataAsk) => void};

/**
 * The Add data sheet: the ways in (import a statement file, connect a bank), the import's steps and the bank
 * list. The shell asks it through `ref`, and it owns the import's state from its first opening on.
 */
export function AddDataSheet({
  ref,
  openerRef,
  importOn,
  onConnect,
  isStarting,
  onState,
}: {
  ref: Ref<SheetHandle>;
  /** Where focus goes back to when the sheet closes; the shell sets it from the click that asked. */
  openerRef: RefObject<HTMLElement | null>;
  importOn: boolean;
  onConnect: (bank: Pick<BankConnectionAspsp, 'name' | 'country'>) => void | Promise<void>;
  isStarting: boolean;
  onState: (state: SheetState) => void;
}) {
  const isMobile = useIsMobile();
  const [view, setView] = useState<View>('import');
  // Whether the open flow started from the ways in, so its first step can go back to them.
  const [fromMenu, setFromMenu] = useState(false);
  const showImportSteps = useCallback(() => {
    setView('import');
    setFromMenu(false);
  }, []);
  // A drop or a toast's View opens the import with no button to go back to.
  const onShow = useCallback(() => {
    openerRef.current = null;
    showImportSteps();
  }, [openerRef, showImportSteps]);
  const fileImport = useFileImport({onShow});
  const {open, setOpen, openNew, show, step, importDropped} = fileImport;
  const [connectStep, setConnectStep] = useState<ConnectStep>(BANK_LIST);
  // The country the owner chose stays while the sheet closes and opens again.
  const [countryCode, setCountryCode] = useState<string>();

  const busy = BUSY.includes(step.kind);
  useEffect(() => onState({open, busy}), [busy, onState, open]);

  const answer = useCallback(
    (ask: AddDataAsk) => {
      const openImport = () => {
        showImportSteps();
        openNew();
      };
      const openConnect = (next: ConnectStep = BANK_LIST) => {
        setView('connect');
        setFromMenu(false);
        setConnectStep(next);
        setOpen(true);
      };
      switch (ask.kind) {
        case 'menu':
          // With import off there is one way in; an unsettled import is where the sheet was left.
          if (!importOn) return openConnect();
          if (isUnsettled(step)) return openImport();
          setView('menu');
          setFromMenu(true);
          setOpen(true);
          return;
        case 'import':
          return openImport();
        case 'connect':
          return openConnect();
        case 'show': {
          // Opened from a row's button, which focus goes back to; `onShow` forgets it for drops and toasts.
          const from = openerRef.current;
          show(ask.step);
          openerRef.current = from;
          return;
        }
        case 'drop':
          return importDropped(ask.files);
        case 'returned':
          return openConnect({kind: 'returned', result: ask.result, bank: ask.bank});
      }
    },
    [importDropped, importOn, openNew, openerRef, setOpen, show, showImportSteps, step],
  );
  useImperativeHandle(ref, () => ({answer}), [answer]);

  const startImport = () => {
    openNew();
    setView('import');
  };

  return (
    <ResponsiveDialog side open={open} onOpenChange={setOpen}>
      <ResponsiveDialogContent
        data-testid='add-data-sheet'
        className='flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 md:h-full md:max-h-none md:w-full md:max-w-lg [&>button:last-child]:hidden'
        onCloseAutoFocus={(event) => {
          if (!openerRef.current?.isConnected) return;
          event.preventDefault();
          openerRef.current.focus();
        }}
      >
        {/* Centred on the title's row; a phone sheet closes by its handle like the others. */}
        {!isMobile && <ResponsiveDialogCornerClose label='Close' />}
        {view === 'menu' ? (
          <AddDataMenu
            onImport={startImport}
            onConnect={() => {
              setConnectStep(BANK_LIST);
              setView('connect');
            }}
          />
        ) : view === 'import' && importOn ? (
          // The ways in lead on, and each flow's first step leads back to them when the sheet opened there.
          <FileImportSteps
            controller={fileImport}
            onBack={fromMenu ? () => setView('menu') : undefined}
          />
        ) : (
          <ConnectBankSteps
            step={connectStep}
            onStep={setConnectStep}
            countryCode={countryCode}
            onCountryCode={setCountryCode}
            onBack={fromMenu ? () => setView('menu') : undefined}
            onConnect={onConnect}
            isStarting={isStarting}
            onImportInstead={
              importOn
                ? () => {
                    openNew();
                    showImportSteps();
                  }
                : undefined
            }
          />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

const OPTION =
  'grid min-h-15 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';

/** The ways in: importing a statement file, or connecting a bank. */
function AddDataMenu({onImport, onConnect}: {onImport: () => void; onConnect: () => void}) {
  const options = [
    {
      icon: FileUp,
      title: 'Import a statement file',
      line: "A file you download from your bank's website",
      onClick: onImport,
    },
    {
      icon: Landmark,
      title: 'Connect a bank',
      line: 'Its new transactions arrive by themselves',
      onClick: onConnect,
    },
  ];
  return (
    <StepFrame
      title='Add data'
      srDescription='Import a statement file or connect a bank.'
      body={
        <ul className='divide-y rounded-lg border'>
          {options.map((option) => (
            <li key={option.title}>
              <button type='button' className={OPTION} onClick={option.onClick}>
                <span aria-hidden='true' className={IMPORT_TILE}>
                  <option.icon strokeWidth={2} />
                </span>
                <span className='min-w-0'>
                  <span className='block text-body font-medium wrap-anywhere'>{option.title}</span>
                  <span className='block text-body-small text-muted-foreground'>{option.line}</span>
                </span>
                <ChevronRight aria-hidden='true' className='size-4 text-muted-foreground' />
              </button>
            </li>
          ))}
        </ul>
      }
    />
  );
}
