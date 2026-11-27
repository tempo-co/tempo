import type {BankConnection} from '@tempo/contracts';
import {Circle, FileUp, Hourglass, Landmark} from 'lucide-react';
import {useEffect} from 'react';

import {StateMessage} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {useAddData} from '@/features/add-data/use-add-data';
import {useCanDropFiles} from '@/features/file-import/components/drop-files';
import {IMPORT_TILE} from '@/features/file-import/utils/import-tile';
import {useIsWide} from '@/hooks/use-is-wide';
import {cn} from '@/utils/cn';

import {IMPORT_STEP, setupSteps} from '../utils/to-do-rows';

/**
 * Home before any data: one Add data panel and Getting started. While it is shown, Add data opens as the first run,
 * a centred dialog that closes on the filled Home after its import.
 */
export function EmptyHome() {
  const addData = useAddData();
  const {setFirstRun} = addData;
  const wide = useIsWide();
  useEffect(() => {
    setFirstRun(true);
    return () => setFirstRun(false);
  }, [setFirstRun]);

  const panel = <AddDataPanel />;
  const steps = <GettingStarted />;
  return wide ? (
    <div className='grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-3'>
      {panel}
      <aside aria-label='Getting started' className='sticky top-6 grid gap-3'>
        {steps}
      </aside>
    </div>
  ) : (
    <div className='grid gap-3'>
      {panel}
      {steps}
    </div>
  );
}

/** The one thing to do first: pick the bank and its file, or drop a file on desktop. */
function AddDataPanel() {
  const {importOn, openImport, openMenu, openConnect} = useAddData();
  const canDrop = useCanDropFiles();
  return (
    <Card role='region' aria-labelledby='first-run-title' className='grid gap-4 p-4 md:p-6'>
      <div className='grid gap-1'>
        <h2 id='first-run-title' className='text-section-title text-balance'>
          See where your money goes, from one bank statement
        </h2>
        <p className='max-w-[60ch] text-body text-pretty text-muted-foreground'>
          Download a statement file from your bank’s website and add it here. Its transactions are
          sorted into categories and fill in your Home.
        </p>
      </div>
      {importOn ? (
        <>
          {canDrop && (
            <div
              data-testid='first-run-drop-hint'
              className='grid min-h-32 place-content-center justify-items-center gap-2 rounded-md border border-dashed p-4 text-center'
            >
              <span aria-hidden='true' className={IMPORT_TILE}>
                <FileUp strokeWidth={2} />
              </span>
              <p className='text-body'>
                <span className='font-medium'>Drop a statement file here</span>
                <span className='text-muted-foreground'>
                  {' '}
                  or choose your bank first to see how to get one
                </span>
              </p>
            </div>
          )}
          <div className='flex flex-col gap-2 sm:flex-row sm:flex-wrap'>
            <Button onClick={(event) => openImport(event)} className={cn(!canDrop && 'w-full')}>
              <Landmark aria-hidden='true' />
              Choose your bank
            </Button>
            <Button variant='ghost' onClick={(event) => openConnect(event)}>
              Connect a bank instead
            </Button>
          </div>
        </>
      ) : (
        <div>
          <Button onClick={(event) => openMenu(event)}>Add data</Button>
        </div>
      )}
    </Card>
  );
}

/** The setup steps whose features exist, none done yet before any data. */
function GettingStarted() {
  const {importOn} = useAddData();
  const steps = setupSteps({hasData: false, toCheck: 0}).filter(
    ({label}) => importOn || label !== IMPORT_STEP,
  );
  return (
    <Card role='region' aria-label='Getting started' className='grid gap-3 p-4'>
      <h2 className='text-card-title'>Getting started</h2>
      <ol className='grid gap-2'>
        {steps.map(({label}) => (
          <li key={label} className='flex items-center gap-2 text-body'>
            <Circle aria-hidden='true' className='size-4 text-muted-foreground' />
            {label}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** A bank connected for the first time, still fetching: Home waits for it rather than showing empty figures. */
export function DataOnItsWay({connections}: {connections: BankConnection[]}) {
  const banks = [...new Set(connections.map(({aspspName}) => aspspName.trim()))];
  const named = banks.length === 1 ? banks[0] : 'Your banks';
  return (
    <StateMessage
      icon={Hourglass}
      title='Your data is on its way'
      description={`${named} ${banks.length === 1 ? 'is' : 'are'} sending your transactions. Home fills in as soon as they arrive, usually within a few minutes.`}
    />
  );
}
