import type {RecurringSeries} from '@wisp/contracts';

import {Badge} from '@/components/ui/badge';
import {cn} from '@/utils/cn';

import type {SeriesFlag} from '../utils/recurring-month';
import {SeriesTile} from './recurring-series-tile';

const FLAG_LABELS: Record<SeriesFlag, string> = {late: 'Late', pricier: 'Pricier', ended: 'Ended'};

/** One series on the Recurring page: the shared 60px row, with its flags beside the name. */
export function RecurringSeriesRow({
  series,
  detail,
  amount,
  hint,
  flags,
  selected,
  muted = false,
  onOpen,
}: {
  series: RecurringSeries;
  /** The second line: rhythm and the date that matters here. */
  detail: string;
  amount: string;
  /** A short line under the amount: a price change, a range or the monthly cost. */
  hint?: string | null;
  flags: SeriesFlag[];
  selected: boolean;
  muted?: boolean;
  onOpen: (key: string) => void;
}) {
  const isIncome = series.direction === 'INCOME';
  const flagText = flags.map((flag) => FLAG_LABELS[flag]).join(', ');
  return (
    <button
      type='button'
      onClick={() => onOpen(series.key)}
      aria-current={selected || undefined}
      aria-label={[series.name, flagText, detail, `${isIncome ? '+' : ''}${amount}`, hint]
        .filter(Boolean)
        .join(', ')}
      className={cn(
        'flex min-h-15 w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=true]:bg-accent',
      )}
    >
      <SeriesTile series={series} className={cn(muted && 'opacity-70')} />
      <span className={cn('min-w-0 flex-1', muted && 'opacity-70')}>
        <span className='flex min-w-0 items-center gap-1.5'>
          <span className='truncate text-body font-medium'>{series.name}</span>
          {flags.map((flag) => (
            <Badge
              key={flag}
              variant={flag === 'ended' ? 'secondary' : 'outline'}
              className={cn(
                'shrink-0 px-2 py-0',
                flag !== 'ended' && 'border-warning/60 text-warning',
              )}
            >
              {FLAG_LABELS[flag]}
            </Badge>
          ))}
        </span>
        <span className='block truncate text-body-small text-muted-foreground'>{detail}</span>
      </span>
      <span className={cn('shrink-0 text-right', muted && 'opacity-70')}>
        <span className={cn('block numeric text-body font-medium', isIncome && 'text-success')}>
          {isIncome && '+'}
          {amount}
        </span>
        {hint && (
          <span className='block numeric text-body-small whitespace-nowrap text-muted-foreground'>
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}
