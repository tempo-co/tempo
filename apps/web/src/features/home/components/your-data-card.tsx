import type {BankConnection, DataCoverage} from '@wisp/contracts';
import {format} from 'date-fns';
import {FileUp} from 'lucide-react';
import type {MouseEvent, ReactNode} from 'react';

import {LoadErrorState} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {accountName} from '@/features/banking/utils/bank-account-name';
import {Bone, LoadingLabel, TextBone} from '@/features/dashboard/components/loading';
import {parseCalendarDate} from '@/features/dashboard/utils/drill-links';
import {cn} from '@/utils/cn';

import {type CoverageState, coverageDays} from '../utils/coverage-days';
import {type CardEditing, HomeCard} from './home-card';

const shortDay = (date: string) => format(parseCalendarDate(date), 'd MMM');

/** Accounts named as running behind before the rest are counted. */
const BEHIND_NAMED = 2;

const CELL: Record<CoverageState, string> = {
  all: 'bg-chart-primary',
  some: 'bg-chart-secondary ring-1 ring-inset ring-chart-secondary-edge',
  none: 'bg-muted',
};

/**
 * How far the owner's data runs: the newest covered day, the accounts that run behind it, and a strip of the last 30
 * days, each marked as covered by every account, by some, or by none. Import a newer file opens the import.
 */
export function YourDataCard({
  coverage,
  connections,
  failure,
  onImport,
  editing,
}: {
  coverage: DataCoverage | undefined;
  connections: BankConnection[];
  failure?: {error: unknown; retry: () => unknown};
  /** Absent while file import is off. */
  onImport?: (event: MouseEvent<HTMLElement>) => void;
  editing?: CardEditing;
}) {
  const card = (children: ReactNode) => (
    <HomeCard name='Your data' editing={editing}>
      {children}
    </HomeCard>
  );
  if (!coverage && failure)
    return card(
      <LoadErrorState
        size='section'
        title="Couldn't load how far your data runs"
        error={failure.error}
        onRetry={failure.retry}
      />,
    );
  if (!coverage) return card(<YourDataSkeleton withImport={!!onImport} />);

  const names = new Map(
    connections.flatMap((connection) =>
      connection.bankAccounts.map((account) => [account.id, accountName(account)] as const),
    ),
  );
  const last = coverage.lastCoveredDay;
  const behind = coverage.accounts.filter(
    (account) => names.has(account.bankAccountId) && account.coveredThrough !== last,
  );
  const days = coverageDays(coverage);
  const counts = {all: 0, some: 0, none: 0};
  for (const day of days) counts[day.state]++;

  return card(
    <>
      <div className='grid gap-0.5'>
        <p className='text-body font-medium'>
          {last ? `Your data runs up to ${shortDay(last)}` : 'No data has come in yet'}
        </p>
        {behind.length > 0 && (
          <p className='text-body-small text-muted-foreground'>
            {behind
              .slice(0, BEHIND_NAMED)
              .map(
                (account) =>
                  `${names.get(account.bankAccountId)} ${account.coveredThrough ? `up to ${shortDay(account.coveredThrough)}` : 'has none yet'}`,
              )
              .join(' · ')}
            {behind.length > BEHIND_NAMED && ` · ${behind.length - BEHIND_NAMED} more behind`}
          </p>
        )}
      </div>
      <div className='grid gap-1'>
        <ol
          data-testid='coverage-strip'
          aria-label={`The last ${days.length} days: ${counts.all} covered by every account, ${counts.some} by some, ${counts.none} by none`}
          className='grid grid-cols-[repeat(30,minmax(0,1fr))] gap-0.5'
        >
          {days.map((day, index) => (
            <li
              key={day.date}
              data-state={day.state}
              title={`${shortDay(day.date)}: ${STATE_LABEL[day.state]}`}
              className={cn(
                'h-4 rounded-sm',
                CELL[day.state],
                index === days.length - 1 && 'outline-1 outline-offset-1 outline-foreground',
              )}
            />
          ))}
        </ol>
        <p aria-hidden='true' className='flex justify-between text-caption text-muted-foreground'>
          <span>{shortDay(coverage.from)}</span>
          <span>today</span>
        </p>
      </div>
      {onImport && (
        <Button variant='outline' className='w-full' onClick={onImport}>
          <FileUp aria-hidden='true' />
          Import a newer file
        </Button>
      )}
    </>,
  );
}

const STATE_LABEL: Record<CoverageState, string> = {
  all: 'every account',
  some: 'some accounts',
  none: 'no data',
};

/** The loaded card's shape: the headline, the strip with its captions, and the import button when there is one. */
function YourDataSkeleton({withImport}: {withImport: boolean}) {
  return (
    <div aria-busy='true' className='grid gap-3'>
      <p className='text-body'>
        <TextBone className='w-[12em]' />
      </p>
      <div className='grid gap-1'>
        <Bone className='h-4' />
        <p className='text-caption'>
          <TextBone className='w-[4em]' />
        </p>
      </div>
      {withImport && <Bone className='h-8 max-sm:h-11 pointer-coarse:h-11' />}
      <LoadingLabel>Loading how far your data runs</LoadingLabel>
    </div>
  );
}
