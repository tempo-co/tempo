import {ChevronRight, FileUp, Landmark} from 'lucide-react';
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {toast} from 'sonner';

import {StepFrame} from '@/components/shared/step-frame';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogCornerClose,
} from '@/components/ui/responsive-dialog';
import {takeConnectingBank, useConnectBank} from '@/features/accounts/api/use-connect-bank';
import {
  ConnectBankSteps,
  type ConnectStep,
} from '@/features/banking/components/bank-connection-picker';
import {useBankImports} from '@/features/file-import/api/use-bank-imports';
import {IMPORT_TILE} from '@/features/file-import/components/file-choice';
import {FileImportSteps} from '@/features/file-import/components/file-import-steps';
import {PageFileDrop} from '@/features/file-import/components/page-file-drop';
import {
  BUSY,
  type FileImportController,
  type ImportStep,
  isUnsettled,
  useFileImport,
} from '@/features/file-import/components/use-file-import';
import {useIsMobile} from '@/hooks/use-is-mobile';

import {type AddData, AddDataContext, type ConnectResult, useAddData} from '../use-add-data';

type View = 'menu' | 'import' | 'connect';

const BANK_LIST: ConnectStep = {kind: 'bank'};

/**
 * Add data for the signed-in shell: one stepped sheet (along the right edge on desktop, a bottom sheet on phones)
 * that offers importing a file and connecting a bank and runs either one. Its state lives here, so an import keeps
 * going while the sheet is closed or the owner moves to another page.
 */
export function AddDataProvider({children}: {children: ReactNode}) {
  const imports = useBankImports();
  const importOn = imports.state === 'on';
  const [view, setView] = useState<View>('import');
  // Whether the open flow started from the ways in, so its first step can go back to them.
  const [fromMenu, setFromMenu] = useState(false);
  const showImportSteps = useCallback(() => {
    setView('import');
    setFromMenu(false);
  }, []);
  const fileImport = useFileImport({onShow: showImportSteps});
  const {connect, isStarting} = useConnectBank();
  const [connectStep, setConnectStep] = useState<ConnectStep>(BANK_LIST);
  // The country the owner chose stays while the sheet closes and opens again.
  const [countryCode, setCountryCode] = useState<string>();
  // Where focus goes back to when the sheet closes, since it opens from many places.
  const opener = useRef<HTMLElement | null>(null);
  const {setOpen, openNew, show} = fileImport;
  // Read when Add data opens, so the actions stay the same from render to render.
  const latest = useRef({step: fileImport.step, importOn});
  useEffect(() => {
    latest.current = {step: fileImport.step, importOn};
  });

  const actions = useMemo(() => {
    const remember = () => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    };
    const openImport = () => {
      remember();
      showImportSteps();
      openNew();
    };
    const openConnect = () => {
      remember();
      setView('connect');
      setFromMenu(false);
      setConnectStep(BANK_LIST);
      setOpen(true);
    };
    return {
      openMenu: () => {
        // With import off there is one way in; an unsettled import is where the sheet was left.
        if (!latest.current.importOn) return openConnect();
        if (isUnsettled(latest.current.step)) return openImport();
        remember();
        setView('menu');
        setFromMenu(true);
        setOpen(true);
      },
      openImport,
      openConnect,
      showImport: (next: ImportStep) => {
        remember();
        show(next);
      },
      connectReturned: (result: ConnectResult) => {
        const bank = takeConnectingBank();
        if (result === 'connected') {
          toast.success('Bank connection added', {id: 'bank-connection-success'});
          return;
        }
        setView('connect');
        setFromMenu(false);
        // A second call for the same return (React's development double run) keeps the bank the first one read.
        setConnectStep((current) => ({
          kind: 'returned',
          result,
          bank: bank ?? (current.kind === 'returned' ? current.bank : null),
        }));
        setOpen(true);
      },
    };
  }, [openNew, setOpen, show, showImportSteps]);
  const value = useMemo<AddData>(
    () => ({...actions, importOn, fileImport, isStarting}),
    [actions, fileImport, importOn, isStarting],
  );

  return (
    <AddDataContext.Provider value={value}>
      {children}
      <AddDataSheet
        controller={fileImport}
        view={view}
        opener={opener}
        // The ways in lead on, and each flow's first step leads back to them when the sheet opened there.
        onMenu={fromMenu ? () => setView('menu') : undefined}
        onImport={() => {
          openNew();
          setView('import');
        }}
        onConnect={() => {
          setConnectStep(BANK_LIST);
          setView('connect');
        }}
        connect={
          <ConnectBankSteps
            step={connectStep}
            onStep={setConnectStep}
            countryCode={countryCode}
            onCountryCode={setCountryCode}
            onBack={fromMenu ? () => setView('menu') : undefined}
            onConnect={connect}
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
        }
        importOn={importOn}
      />
    </AddDataContext.Provider>
  );
}

function AddDataSheet({
  controller,
  view,
  opener,
  onMenu,
  onImport,
  onConnect,
  connect,
  importOn,
}: {
  controller: FileImportController;
  view: View;
  opener: RefObject<HTMLElement | null>;
  onMenu?: () => void;
  onImport: () => void;
  onConnect: () => void;
  connect: ReactNode;
  importOn: boolean;
}) {
  const isMobile = useIsMobile();
  return (
    <ResponsiveDialog side open={controller.open} onOpenChange={controller.setOpen}>
      <ResponsiveDialogContent
        data-testid='add-data-sheet'
        className='flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 md:h-full md:max-h-none md:w-full md:max-w-lg [&>button:last-child]:hidden'
        onCloseAutoFocus={(event) => {
          if (!opener.current?.isConnected) return;
          event.preventDefault();
          opener.current.focus();
        }}
      >
        {/* Centred on the title's row; a phone sheet closes by its handle like the others. */}
        {!isMobile && <ResponsiveDialogCornerClose label='Close' />}
        {view === 'menu' ? (
          <AddDataMenu onImport={onImport} onConnect={onConnect} />
        ) : view === 'import' && importOn ? (
          <FileImportSteps controller={controller} onBack={onMenu} />
        ) : (
          connect
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

/**
 * Files dragged anywhere over the page column import in the Add data sheet, while file import is on, the sheet is
 * closed and no import is running.
 */
export function AddDataDrop() {
  const {importOn, fileImport} = useAddData();
  if (!importOn) return null;
  return (
    <PageFileDrop
      enabled={!fileImport.open && !BUSY.includes(fileImport.step.kind)}
      onFiles={fileImport.importDropped}
    />
  );
}
