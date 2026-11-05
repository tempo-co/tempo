import {Link, useNavigate} from '@tanstack/react-router';
import type {
  BankTransactionBreakdownPeriod,
  BankTransactionCategoryFilterValue,
} from '@tempo/contracts';
import {format} from 'date-fns';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import {type KeyboardEvent, useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogCornerClose,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Skeleton} from '@/components/ui/skeleton';
import {useGetBankTransactions} from '@/features/banking/api/use-get-bank-transactions';
import {TransactionListRow} from '@/features/banking/components/transaction-list-row';
import {useGetMerchantRanking} from '@/features/merchants/api/use-get-merchant-ranking';
import {MerchantRow} from '@/features/merchants/components/merchant-row';
import {countLabel, formatUsualComparison} from '@/features/merchants/utils/merchant-format';
import {cn} from '@/utils/cn';

import {HOME_REFRESH_INTERVAL_MS} from '../api/refresh-interval';
import {useGetBankTransactionBreakdown} from '../api/use-get-bank-transaction-breakdown';
import {useHasMissingBaseAmounts} from '../api/use-get-bank-transaction-review-counts';
import {useOverview} from '../api/use-overview';
import {
  categoryDrill,
  eventDrill,
  flowDrill,
  parseCalendarDate,
  periodDrill,
} from '../utils/drill-links';
import {categoryColor, categoryLabel, pct, signed, signedPct, wholeCents} from '../utils/format';
import {formatMoney, toCents} from '../utils/money';
import {monthDates, shiftMonth} from '../utils/month';
import {historyFrom} from '../utils/overview';
import {EventLine} from './event-line';

/** Rows shown before "Show all"; the list itself asks for one API page. */
const FIRST_ROWS = 12;
const PAGE_SIZE = 100;
/** A category's usual is the mean of this many months before, every one inside the history. */
const USUAL_MONTHS = 12;

const monthTitle = (month: string) => format(parseCalendarDate(`${month}-01`), 'MMMM yyyy');

/** One month over Home, at `?month=YYYY-MM`: Back or Escape closes it, the arrows (or ← →) step months. */
export function MonthDialog({
  month,
  today,
  onStep,
  onOpenChange,
}: {
  month: string | null;
  today: string;
  onStep: (month: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const {overview} = useOverview(today);
  const index =
    overview && month ? overview.months.findIndex((point) => point.month === month) : -1;
  const prev = overview && index > 0 ? overview.months[index - 1].month : null;
  const next =
    overview && index >= 0 && index < overview.months.length - 1
      ? overview.months[index + 1].month
      : null;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('input, textarea, select, [contenteditable]')
    )
      return;
    const target = event.key === 'ArrowLeft' ? prev : event.key === 'ArrowRight' ? next : null;
    if (!target) return;
    event.preventDefault();
    onStep(target);
  };
  return (
    <ResponsiveDialog open={month !== null} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        onKeyDown={onKeyDown}
        className='flex h-[94dvh] max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:h-[min(94vh,72rem)] sm:max-h-[94vh] sm:max-w-6xl [&>button:last-child]:hidden'
      >
        <ResponsiveDialogCornerClose label='Close the month' />
        <ResponsiveDialogHeader className='shrink-0 border-b px-3 py-2 pr-16 text-left sm:px-4'>
          <nav aria-label='Months' className='flex items-center gap-1'>
            <StepButton month={prev} label='Previous month' icon={ChevronLeft} onStep={onStep} />
            <ResponsiveDialogTitle className='min-w-[10ch] text-center text-xl leading-tight sm:text-2xl'>
              {month ? monthTitle(month) : ''}
            </ResponsiveDialogTitle>
            <StepButton month={next} label='Next month' icon={ChevronRight} onStep={onStep} />
          </nav>
          <ResponsiveDialogDescription className='sr-only'>
            What came in and went out, and where it went.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {/* Keyed by month, so stepping starts at the top with the list folded again. */}
        <ScrollArea
          key={month}
          type='always'
          className='min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block'
        >
          <div className='@container p-4 sm:p-6'>
            {month && <MonthView month={month} today={today} />}
          </div>
        </ScrollArea>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function StepButton({
  month,
  label,
  icon: Icon,
  onStep,
}: {
  month: string | null;
  label: string;
  icon: typeof ChevronLeft;
  onStep: (month: string) => void;
}) {
  return (
    <button
      type='button'
      disabled={!month}
      onClick={() => month && onStep(month)}
      aria-label={label}
      className='grid size-11 shrink-0 place-items-center hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30 disabled:hover:bg-transparent'
    >
      <Icon aria-hidden='true' className='size-5' />
    </button>
  );
}

/**
 * What came in and went out, what was kept and the balance the month ended on; where the money went (with each
 * category's usual), the transactions, one-off payments, where it came from and the biggest merchants.
 */
function MonthView({month, today}: {month: string; today: string}) {
  const {overview, isError, refetch} = useOverview(today);
  const from = historyFrom(today);
  const categories = useGetBankTransactionBreakdown('month', 'category', from, today, today);
  const sources = useGetBankTransactionBreakdown('month', 'source', from, today, today);
  const dates = monthDates(month);
  const point = overview?.months.find((item) => item.month === month);
  const end = point?.end ?? dates.to;

  if (isError || categories.isError || sources.isError)
    return (
      <div className='grid justify-items-start gap-4'>
        <p>Could not load this month.</p>
        <Button
          variant='outline'
          onClick={() =>
            void Promise.all([
              refetch(),
              categories.isError && categories.refetch(),
              sources.isError && sources.refetch(),
            ])
          }
        >
          Try again
        </Button>
      </div>
    );
  if (!overview || !categories.breakdown || !sources.breakdown)
    return <Skeleton className='h-[36rem]' role='img' aria-label='Loading the month' />;
  if (!point)
    return <p className='text-sm text-muted-foreground'>No history for {monthTitle(month)}.</p>;

  const currency = overview.currency;
  const index = overview.months.indexOf(point);
  const before = index > 0 ? overview.months[index - 1] : null;
  const share = point.income > 0 ? point.kept / point.income : null;
  const periodOf = (periods: BankTransactionBreakdownPeriod[]) =>
    periods.find((period) => period.start.slice(0, 7) === month);
  const earlier = categories.breakdown.periods.filter((period) => {
    const start = period.start.slice(0, 7);
    return start < month && start >= shiftMonth(month, -USUAL_MONTHS);
  });
  // As for one-off payments: no usual without a full year of history before the month.
  const usualOf = (key: string) =>
    earlier.length < USUAL_MONTHS
      ? null
      : earlier.reduce(
          (sum, period) =>
            sum + toCents(period.parts.find((part) => part.key === key)?.amount ?? '0'),
          0,
        ) / USUAL_MONTHS;
  const balanceChange =
    before?.balance != null && point.balance !== null ? point.balance - before.balance : null;

  return (
    <div className='grid gap-6'>
      <section
        aria-label='The month'
        className='grid grid-cols-1 gap-x-6 gap-y-4 border bg-card p-5 sm:p-6 @[21rem]:grid-cols-2 @[760px]:grid-cols-4'
      >
        <Figure label='In' value={wholeCents(point.income, currency)} tone='text-success' />
        <Figure label='Out' value={wholeCents(point.spending, currency)} />
        <Figure
          label={point.complete ? 'Kept' : 'Kept so far'}
          value={signed(point.kept, currency)}
          tone={point.kept < 0 ? 'text-warning' : undefined}
          sub={share === null ? undefined : `${pct(share)} of in`}
        />
        <Figure
          label={point.complete ? 'Balance at month end' : 'Balance now'}
          value={wholeCents(point.balance, currency)}
          sub={
            before && balanceChange !== null
              ? `${signed(balanceChange, currency)} on ${format(parseCalendarDate(`${before.month}-01`), 'MMM')}`
              : undefined
          }
        />
      </section>

      <div className='grid gap-6 @[1000px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]'>
        <div className='grid min-w-0 content-start gap-6'>
          <WhereItWent
            period={periodOf(categories.breakdown.periods)}
            usualOf={usualOf}
            currency={currency}
            from={dates.from}
            to={end}
          />
          <MonthTransactions from={dates.from} to={end} />
        </div>
        <div className='grid min-w-0 content-start gap-6'>
          {point.events.length > 0 && (
            <section aria-label='One-off payments' className='grid gap-2 border bg-card p-5'>
              <h2 className='text-card-title'>One-off payments</h2>
              <ul className='-mx-2 grid'>
                {point.events.map((event) => (
                  <li key={event.id}>
                    <Link
                      to='/bank-transactions'
                      search={eventDrill(event)}
                      className='block px-2 py-2 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring'
                    >
                      <EventLine event={event} currency={currency} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <WhereItCameFrom
            period={periodOf(sources.breakdown.periods)}
            currency={currency}
            from={dates.from}
            to={end}
          />
          <BiggestMerchants month={month} today={today} />
        </div>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: string;
  sub?: string;
}) {
  return (
    <div className='min-w-0'>
      <p className='text-label text-muted-foreground'>{label}</p>
      <p
        className={cn('numeric text-2xl font-semibold whitespace-nowrap max-[30rem]:text-xl', tone)}
      >
        {value}
      </p>
      {sub && <p className='numeric text-xs text-muted-foreground'>{sub}</p>}
    </div>
  );
}

/** Each category's amount as a bar, with a tick at its usual. */
function WhereItWent({
  period,
  usualOf,
  currency,
  from,
  to,
}: {
  period: BankTransactionBreakdownPeriod | undefined;
  usualOf: (key: string) => number | null;
  currency: string | null;
  from: string;
  to: string;
}) {
  const missingBaseAmounts = useHasMissingBaseAmounts();
  const parts = (period?.parts ?? []).filter((part) => toCents(part.amount) > 0);
  const max = Math.max(
    1,
    ...parts.map((part) => Math.max(toCents(part.amount), usualOf(part.key) ?? 0)),
  );
  const hasUsual = parts.some((part) => usualOf(part.key) !== null);
  return (
    <section aria-label='Where it went' className='grid gap-3 border bg-card p-5 sm:p-6'>
      <header className='flex flex-wrap items-baseline justify-between gap-x-3'>
        <h2 className='text-card-title'>Where it went</h2>
        {hasUsual && (
          <span className='inline-flex items-center gap-1.5 text-xs text-muted-foreground'>
            <i aria-hidden='true' className='h-3 w-0.5 bg-foreground' /> usual, last 12 months
          </span>
        )}
      </header>
      {parts.length === 0 && <p className='text-sm text-muted-foreground'>No spending.</p>}
      <ul className='grid gap-1'>
        {parts.map((part) => {
          const value = toCents(part.amount);
          const usual = usualOf(part.key);
          return (
            <li key={part.key}>
              <Link
                to='/bank-transactions'
                search={categoryDrill(
                  part.key as BankTransactionCategoryFilterValue,
                  from,
                  to,
                  missingBaseAmounts,
                )}
                className='grid min-h-11 grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring max-sm:grid-cols-[minmax(0,1fr)_auto]'
              >
                <span className='flex min-w-0 items-center gap-2'>
                  <i
                    aria-hidden='true'
                    className='size-2.5 shrink-0'
                    style={{background: categoryColor(part.key)}}
                  />
                  <span className='truncate'>{categoryLabel(part.key)}</span>
                </span>
                <span aria-hidden='true' className='relative block h-3 bg-muted max-sm:hidden'>
                  <span
                    className='absolute inset-y-0 left-0 bg-chart-primary'
                    style={{width: `${(value / max) * 100}%`}}
                  />
                  {usual !== null && usual > 0 && (
                    <span
                      className='absolute -inset-y-1 w-0.5 bg-foreground'
                      style={{left: `${(usual / max) * 100}%`}}
                    />
                  )}
                </span>
                <span className='min-w-24 text-right numeric'>
                  {wholeCents(value, currency)}
                  {usual !== null && usual > 0 && (
                    <span className='block text-xs text-muted-foreground'>
                      {signedPct((value - usual) / usual)} on usual
                    </span>
                  )}
                  {usual === 0 && (
                    <span className='block text-xs text-muted-foreground'>none usually</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MonthTransactions({from, to}: {from: string; to: string}) {
  const [showAll, setShowAll] = useState(false);
  const bookingDate = {from: parseCalendarDate(from), to: parseCalendarDate(to)};
  const {data, isPending, isError, refetch} = useGetBankTransactions(
    {pageIndex: 0, pageSize: PAGE_SIZE, bookingDate},
    // Fresh like the rest of Home while the month stays open, so late categorization and logos show up.
    {staleTime: HOME_REFRESH_INTERVAL_MS, refetchInterval: HOME_REFRESH_INTERVAL_MS},
  );
  const rows = data ? data.transactions.slice(0, showAll ? undefined : FIRST_ROWS) : [];
  return (
    <section aria-label='Transactions' className='min-w-0 border bg-card'>
      <header className='flex items-center justify-between gap-3 px-5 pt-3 pb-1'>
        <h2 className='text-card-title'>Transactions</h2>
        <Link
          to='/bank-transactions'
          search={periodDrill(from, to)}
          className='-mr-2 inline-flex min-h-11 items-center px-2 text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring'
        >
          Open in Transactions
        </Link>
      </header>
      {isPending ? (
        <Skeleton className='m-5 h-40' />
      ) : isError || !data ? (
        <div className='grid justify-items-start gap-3 px-5 pb-5'>
          <p className='text-sm'>Could not load transactions.</p>
          <Button variant='outline' onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : data.transactions.length === 0 ? (
        <p className='px-5 pb-5 text-sm text-muted-foreground'>No transactions this month.</p>
      ) : (
        <ul className='divide-y divide-border/60 px-2 pb-2'>
          {rows.map((transaction) => (
            <li key={transaction.id}>
              <TransactionListRow
                transaction={transaction}
                link={{
                  to: '/bank-transactions',
                  search: {...periodDrill(from, to), transactionId: transaction.id},
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {data && data.transactions.length > FIRST_ROWS && !showAll && (
        <button
          type='button'
          onClick={() => setShowAll(true)}
          className='flex min-h-11 w-full items-center justify-center border-t text-sm text-primary hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
        >
          Show all {data.total}
        </button>
      )}
      {data && showAll && data.total > data.transactions.length && (
        <Link
          to='/bank-transactions'
          search={periodDrill(from, to)}
          className='flex min-h-11 w-full items-center justify-center border-t text-sm text-primary hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
        >
          The other {data.total - data.transactions.length} in Transactions
        </Link>
      )}
    </section>
  );
}

function WhereItCameFrom({
  period,
  currency,
  from,
  to,
}: {
  period: BankTransactionBreakdownPeriod | undefined;
  currency: string | null;
  from: string;
  to: string;
}) {
  const missingBaseAmounts = useHasMissingBaseAmounts();
  const parts = (period?.parts ?? []).filter((part) => toCents(part.amount) > 0);
  const limit = 6;
  const top = parts.slice(0, limit);
  const rest = parts.slice(limit).reduce((sum, part) => sum + toCents(part.amount), 0);
  const max = Math.max(1, ...top.map((part) => toCents(part.amount)));
  return (
    <section aria-label='Where it came from' className='grid gap-3 border bg-card p-5'>
      <h2 className='text-card-title'>Where it came from</h2>
      {parts.length === 0 && <p className='text-sm text-muted-foreground'>No income.</p>}
      <ul className='grid gap-1'>
        {top.map((part) => (
          <li key={part.key}>
            <Link
              to='/bank-transactions'
              search={{...flowDrill('INCOME', from, to, missingBaseAmounts), search: part.label}}
              className='grid min-h-11 grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-3 text-sm hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring'
            >
              <span className='min-w-0'>
                <span className='block truncate'>{part.label}</span>
                <span aria-hidden='true' className='mt-1 block h-1 bg-muted'>
                  <span
                    className='block h-full bg-success'
                    style={{width: `${(toCents(part.amount) / max) * 100}%`}}
                  />
                </span>
              </span>
              <span className='text-right numeric'>
                {wholeCents(toCents(part.amount), currency)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <p className='flex justify-between numeric text-xs text-muted-foreground'>
          <span>{parts.length - limit} more</span>
          <span>{wholeCents(rest, currency)}</span>
        </p>
      )}
    </section>
  );
}

const MERCHANTS = 8;

function BiggestMerchants({month, today}: {month: string; today: string}) {
  // A stable date after a past month ends ranks the whole month without changing its cache key each day.
  const asOf = month === today.slice(0, 7) ? today : `${shiftMonth(month, 1)}-01`;
  const {ranking, isPending, isError, refetch} = useGetMerchantRanking(
    'month',
    `${month}-01`,
    asOf,
    MERCHANTS,
  );
  const navigate = useNavigate({from: '/'});
  const open = (merchant: string) =>
    void navigate({search: (prev) => ({...prev, merchants: 'open', merchant})});
  return (
    <section aria-label='Biggest merchants' className='grid gap-3 border bg-card p-5'>
      <h2 className='text-card-title'>Biggest merchants</h2>
      {isPending ? (
        <Skeleton className='h-40' />
      ) : isError || !ranking ? (
        <div className='grid justify-items-start gap-3'>
          <p className='text-sm'>Could not load merchants.</p>
          <Button variant='outline' onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : ranking.merchants.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No spending this month.</p>
      ) : (
        <ul className='-mx-3 -mb-3 divide-y divide-border/60'>
          {ranking.merchants.map((merchant) => {
            const comparison = formatUsualComparison(merchant, ranking.baseCurrency);
            return (
              <li key={merchant.id}>
                <MerchantRow
                  merchant={merchant}
                  onSelect={open}
                  detail={
                    <>
                      {countLabel(merchant.count, 'transaction')}
                      {comparison && <> · {comparison}</>}
                    </>
                  }
                  amount={formatMoney(merchant.spent, ranking.baseCurrency)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
