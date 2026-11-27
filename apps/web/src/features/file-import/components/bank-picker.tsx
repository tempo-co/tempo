import {BANK_LIST, type Bank, OTHER_BANK_EXPORT_TEXT, OTHER_BANK_ID} from '@tempo/contracts';
import {ChevronRight} from 'lucide-react';
import {useId, useState} from 'react';

import {SearchInput} from '@/components/shared/search-input';
import {TextAction} from '@/components/shared/text-action';
import {Badge} from '@/components/ui/badge';
import {ScrollArea} from '@/components/ui/scroll-area';

import {bankGroups, bankWhere, pickedBank} from '../utils/picked-bank';

/** A list row whose whole width is the target: 56px, so a thumb hits it on a phone. */
const ROW =
  'grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';

/**
 * Which bank a statement file is from, for the Add data sheet and the first run: the verified banks, then the
 * researched ones not yet verified, then Another bank, which every search keeps. Its own list scrolls, and its search
 * is never focused for the owner, so a phone keeps its keyboard closed until the field is tapped.
 */
export function BankPicker({onPick}: {onPick: (id: string) => void}) {
  const [query, setQuery] = useState('');
  const {verified, unverified} = bankGroups(query);
  return (
    // On phones one height whatever the search finds, so nothing jumps under a thumb; on desktop the sheet's own.
    <div className='flex min-h-0 flex-col max-md:h-[min(68dvh,--spacing(128))] md:flex-1'>
      <SearchInput
        value={query}
        onValueChange={setQuery}
        aria-label='Search banks'
        placeholder={`Search ${BANK_LIST.length} banks`}
        autoComplete='off'
        enterKeyHint='search'
        wrapperClassName='mb-2'
        className='h-11'
      />
      <ScrollArea type='auto' className='-mx-2 min-h-0 flex-1'>
        {/* Clear of the scrollbar on the right, so it never touches a row. */}
        <div className='grid pr-5 pl-2'>
          <BankGroup title='Verified' banks={verified} onPick={onPick} />
          <BankGroup title='Not yet verified' banks={unverified} onPick={onPick} />
          {verified.length + unverified.length === 0 && (
            <p className='px-2 py-6 text-center text-body-small text-muted-foreground'>
              No listed bank called “{query.trim()}”
            </p>
          )}
          <ul aria-label='Other banks' className='mt-2 border-t pt-2'>
            <li>
              <button type='button' className={ROW} onClick={() => onPick(OTHER_BANK_ID)}>
                <span className='min-w-0'>
                  <span className='block text-body'>Another bank</span>
                  <span className='block text-body-small text-muted-foreground'>
                    Steps that work for most banks
                  </span>
                </span>
                <ChevronRight aria-hidden='true' className='size-4 text-muted-foreground' />
              </button>
            </li>
          </ul>
        </div>
      </ScrollArea>
    </div>
  );
}

function BankGroup({
  title,
  banks,
  onPick,
}: {
  title: string;
  banks: readonly Bank[];
  onPick: (id: string) => void;
}) {
  const heading = useId();
  if (banks.length === 0) return null;
  return (
    <section className='grid'>
      <h3 id={heading} className='px-2 pt-3 pb-1 text-label text-muted-foreground'>
        {title}
      </h3>
      <ul aria-labelledby={heading} className='grid'>
        {banks.map((bank) => (
          <li key={bank.id}>
            <button type='button' className={ROW} onClick={() => onPick(bank.id)}>
              <span className='min-w-0'>
                <span className='block text-body wrap-anywhere'>{bank.name}</span>
                <span className='block text-body-small text-muted-foreground'>
                  {bankWhere(bank)}
                </span>
              </span>
              <ChevronRight aria-hidden='true' className='size-4 text-muted-foreground' />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * How to download the picked bank's file, above the file choice: the bank, its numbered steps in its own menu labels
 * and the file to pick. A bank not yet verified says so; Another bank gets one text for any bank.
 */
export function BankExportSteps({bankId, onChange}: {bankId: string; onChange?: () => void}) {
  const bank = pickedBank(bankId);
  return (
    <section aria-label='Your bank' className='grid grid-cols-1 gap-3'>
      <div className='flex items-center gap-3'>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
            <span className='text-body font-medium wrap-anywhere'>
              {bank?.name ?? 'Another bank'}
            </span>
            {bank?.status === 'unverified' && <Badge variant='secondary'>Not yet verified</Badge>}
          </div>
          {bank && <p className='text-body-small text-muted-foreground'>{bankWhere(bank)}</p>}
        </div>
        {onChange && (
          <TextAction type='button' aria-label='Change bank' onClick={onChange} className='-mr-2'>
            Change
          </TextAction>
        )}
      </div>
      {bank ? (
        <>
          <ol
            aria-label={`How to get the file from ${bank.name}`}
            className='grid list-decimal gap-1.5 pl-5 text-body marker:text-muted-foreground'
          >
            {bank.exportSteps.steps.map((step) => (
              <li key={step} className='pl-1 text-pretty'>
                {step}
              </li>
            ))}
          </ol>
          <p className='text-body text-pretty'>
            <span className='font-medium'>The file to pick:</span> {bank.exportSteps.file}
          </p>
          {bank.status === 'unverified' && (
            <p className='text-body-small text-pretty text-muted-foreground'>
              From {bank.name}&apos;s help pages. No {bank.name} file has been tested yet.
            </p>
          )}
        </>
      ) : (
        <p className='text-body text-pretty'>{OTHER_BANK_EXPORT_TEXT}</p>
      )}
    </section>
  );
}
