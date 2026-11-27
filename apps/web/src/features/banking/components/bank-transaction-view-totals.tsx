import {Link} from '@tanstack/react-router';
import type {BankTransactionTotals} from '@wisp/contracts';
import {CircleAlert, ListChecks} from 'lucide-react';
import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {TextBone} from '@/features/dashboard/components/loading';
import {formatMoney, toCents} from '@/features/dashboard/utils/money';
import {missingAmountsLabel} from '@/features/reporting-currency/utils/currency-names';
import {cn} from '@/utils/cn';

type Totals = Pick<
  BankTransactionTotals,
  'spending' | 'income' | 'net' | 'count' | 'baseCurrency' | 'excluded'
>;

type ViewTotalsProps = {
  totals: Totals | undefined;
  /** The totals belong to the list on screen; until then the last settled ones stay. */
  settled: boolean;
  /** Whether the rows a total leaves out can be listed; not while the list already shows only them. */
  missingLinked: boolean;
};

/**
 * The last totals that matched the list on screen. While the list and its totals refetch they stay, then swap once
 * both have arrived, so the figures change once, in place, instead of jumping as each lands.
 */
function useSettledTotals(totals: Totals | undefined, settled: boolean) {
  const [shown, setShown] = useState<Totals | null>(settled && totals ? totals : null);
  const keyOf = (value: Totals) =>
    [
      value.count,
      value.spending,
      value.income,
      value.baseCurrency,
      value.excluded.missingBaseAmount,
    ].join(' ');
  if (settled && totals && (!shown || keyOf(totals) !== keyOf(shown))) setShown(totals);
  return shown && {totals: shown, key: keyOf(shown)};
}

const signed = (value: string, currency: string) =>
  `${toCents(value) > 0 ? '+' : ''}${formatMoney(value, currency)}`;

/** The rail's idle card: what the rows in view spent and earned, and their net. */
export function ViewTotalsCard({totals, settled, missingLinked}: ViewTotalsProps) {
  const shown = useSettledTotals(totals, settled);
  const currency = shown?.totals.baseCurrency ?? null;
  return (
    <section
      aria-labelledby='view-totals-title'
      className='rounded-lg border bg-card p-4'
      data-testid='bank-transactions-view-totals'
    >
      <h2 id='view-totals-title' className='text-card-title'>
        This view
      </h2>
      {!shown ? (
        <p className='mt-3 text-body' aria-hidden='true'>
          <TextBone className='w-[10em]' />
        </p>
      ) : (
        // Replaced as a whole when the figures change, so it fades in once.
        <div
          key={shown.key}
          className='animate-in duration-200 fade-in motion-reduce:animate-none'
          aria-live='polite'
        >
          <p className='mt-1 text-body-small text-muted-foreground'>
            {shown.totals.count.toLocaleString()}{' '}
            {shown.totals.count === 1 ? 'transaction' : 'transactions'}
          </p>
          {currency && (
            // No column gap, so the line above Net runs unbroken; the labels keep their distance with padding.
            <dl className='mt-3 grid grid-cols-[minmax(0,1fr)_auto] text-body'>
              <dt className='py-1.5 pr-4 text-muted-foreground'>Spent</dt>
              <dd className='py-1.5 text-right numeric'>
                {formatMoney(shown.totals.spending, currency)}
              </dd>
              <dt className='py-1.5 pr-4 text-muted-foreground'>Income</dt>
              <dd className='py-1.5 text-right numeric text-success'>
                {signed(shown.totals.income, currency)}
              </dd>
              <dt className='border-t pt-2 pr-4 font-medium'>Net</dt>
              <dd className='border-t pt-2 text-right numeric font-medium'>
                {signed(shown.totals.net, currency)}
              </dd>
            </dl>
          )}
          {currency && missingLinked && shown.totals.excluded.missingBaseAmount > 0 && (
            <MissingAmountsLink
              count={shown.totals.excluded.missingBaseAmount}
              currency={currency}
              className='mt-3'
            />
          )}
        </div>
      )}
    </section>
  );
}

/** The phone list's summary strip: spent and income for the rows in view, following the filters. */
export function SummaryStrip({totals, settled, missingLinked}: ViewTotalsProps) {
  const shown = useSettledTotals(totals, settled);
  const currency = shown?.totals.baseCurrency ?? null;
  if (!shown) {
    return (
      <p className='text-body' aria-hidden='true'>
        <TextBone className='w-[10em]' />
      </p>
    );
  }
  const parts = [
    {
      figure: `${shown.totals.count.toLocaleString()}`,
      word: shown.totals.count === 1 ? 'transaction' : 'transactions',
    },
    ...(currency
      ? [
          {figure: formatMoney(shown.totals.spending, currency), word: 'spent'},
          {figure: signed(shown.totals.income, currency), word: 'in', income: true},
        ]
      : []),
  ];
  return (
    <div
      key={shown.key}
      className='grid animate-in justify-items-start gap-0.5 duration-200 fade-in motion-reduce:animate-none'
      data-testid='bank-transactions-summary-strip'
      aria-live='polite'
    >
      <p className='flex flex-wrap gap-x-3 text-body text-muted-foreground'>
        {parts.map((part) => (
          <span key={part.word} className='whitespace-nowrap'>
            <span
              className={cn('numeric font-medium text-foreground', part.income && 'text-success')}
            >
              {part.figure}
            </span>{' '}
            {part.word}
          </span>
        ))}
      </p>
      {currency && missingLinked && shown.totals.excluded.missingBaseAmount > 0 && (
        <MissingAmountsLink count={shown.totals.excluded.missingBaseAmount} currency={currency} />
      )}
    </div>
  );
}

/** The rows a total leaves out, listed under the same filters. */
function MissingAmountsLink({
  count,
  currency,
  className,
}: {
  count: number;
  currency: string;
  className?: string;
}) {
  return (
    <Link
      to='/transactions'
      search={(prev) => ({...prev, baseAmount: 'MISSING' as const})}
      className={cn(
        'inline-flex items-center gap-1.5 text-body-small text-warning underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
      data-testid='missing-base-amounts-link'
    >
      <CircleAlert aria-hidden='true' className='size-3.5 shrink-0' />
      {missingAmountsLabel(count, currency)}
    </Link>
  );
}

/** The rail's second card while rows wait to be checked: how many, and the way into the To check tab. */
export function ToCheckCard({count, onCheck}: {count: number; onCheck: () => void}) {
  return (
    <section
      aria-label='To check'
      className='flex items-center gap-3 rounded-lg border bg-card p-4'
      data-testid='bank-transactions-to-check-card'
    >
      <span
        aria-hidden='true'
        className='grid size-9 shrink-0 place-items-center rounded-full border bg-muted text-muted-foreground'
      >
        <ListChecks className='size-4' />
      </span>
      <p className='min-w-0 flex-1 text-body font-medium'>{count.toLocaleString()} to check</p>
      <Button size='sm' onClick={onCheck}>
        Check
      </Button>
    </section>
  );
}
