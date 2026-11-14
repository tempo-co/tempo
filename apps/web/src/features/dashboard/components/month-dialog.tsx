import {Link, useNavigate} from '@tanstack/react-router';
import type {
  BankTransactionBreakdownPeriod,
  BankTransactionCategoryFilterValue,
} from '@tempo/contracts';
import {ChevronLeft, ChevronRight, CircleAlert} from 'lucide-react';
import {type KeyboardEvent, type ReactNode} from 'react';

import {LoadMore} from '@/components/shared/load-more';
import {LoadErrorState} from '@/components/shared/state-message';
import {TextAction} from '@/components/shared/text-action';
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
import {useHasMissingBaseAmounts} from '@/features/banking/api/use-get-bank-transaction-review-counts';
import {TransactionListRow} from '@/features/banking/components/transaction-list-row';
import {useGetMerchantRanking} from '@/features/merchants/api/use-get-merchant-ranking';
import {MerchantRow} from '@/features/merchants/components/merchant-row';
import {countLabel, formatUsualComparison} from '@/features/merchants/utils/merchant-format';
import {missingAmountsLabel} from '@/features/reporting-currency/utils/currency-names';
import {cn} from '@/utils/cn';

import {useGetBankTransactionBreakdown} from '../api/use-get-bank-transaction-breakdown';
import {useGetBankTransactionSummary} from '../api/use-get-bank-transaction-summary';
import {useGetBankTransactionTotals} from '../api/use-get-bank-transaction-totals';
import {useGetMonthTransactions} from '../api/use-get-month-transactions';
import {useOverview} from '../api/use-overview';
import {categoryDrill, periodDrill, sourceDrill} from '../utils/drill-links';
import {pct, signed, signedPct, wholeCents} from '../utils/format';
import {formatMoney, toCents} from '../utils/money';
import {formatMonth, monthDates, shiftMonth} from '../utils/month';
import {type MonthPoint, type Overview, partCents} from '../utils/overview';
import {CategoryName, SourceTile} from './category-name';
import {Bone, LoadingLabel, TextBone, TileRowsSkeleton} from './loading';

/** A past month's usual is the mean of this many months before, every one inside the history. */
const USUAL_MONTHS = 12;
/**
 * The running month's usual is the API's: the mean of this many months before by the same day of the month, so a
 * month that has just begun is not set against whole months.
 */
const SAME_DAY_USUAL_MONTHS = 3;

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
  // Nothing is requested while the month is closed; Home's own history reads keep the cache warm.
  const history = useOverview(today, {enabled: month !== null});
  const {overview} = history;
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
        <ResponsiveDialogHeader className='shrink-0 border-b py-2 pr-16 pl-1 text-left sm:pl-4'>
          <nav aria-label='Months' className='flex items-center gap-1'>
            <StepButton month={prev} label='Previous month' icon={ChevronLeft} onStep={onStep} />
            {/*
              As wide as the longest month, "September 2026" (8.1em in Inter semibold), whatever month it shows, so the
              arrows stay put while stepping. In em, so it grows with the text; a narrow phone takes a size down to fit.
            */}
            <ResponsiveDialogTitle className='w-[8.5em] shrink-0 text-center text-xl leading-tight whitespace-nowrap max-[22rem]:text-lg sm:text-2xl'>
              {month ? formatMonth(month) : ''}
            </ResponsiveDialogTitle>
            <StepButton month={next} label='Next month' icon={ChevronRight} onStep={onStep} />
          </nav>
          <ResponsiveDialogDescription className='sr-only'>
            What came in and went out, and where it went.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {/* Keyed by month, so stepping starts at the top. */}
        <ScrollArea
          key={month}
          type='always'
          className='min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block'
        >
          <div className='@container p-4 sm:p-6'>
            {month && <MonthView month={month} today={today} history={history} />}
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
    <Button
      variant='ghost'
      size='icon'
      disabled={!month}
      onClick={() => month && onStep(month)}
      aria-label={label}
      className='size-11 shrink-0 focus-visible:-outline-offset-2 disabled:opacity-30 [&_svg]:size-5'
    >
      <Icon aria-hidden='true' />
    </Button>
  );
}

/**
 * What came in and went out, what was kept and the balance the month ended on; where the money went (with each
 * category's usual), the transactions, where it came from and the biggest merchants.
 */
function MonthView({
  month,
  today,
  history: {overview, isError, error, refetch},
}: {
  month: string;
  today: string;
  history: ReturnType<typeof useOverview>;
}) {
  const dates = monthDates(month);
  const point = overview?.months.find((item) => item.month === month);
  const running = month === today.slice(0, 7);
  // Where the history ends the month (today while it runs), known before the history loads.
  const end = running ? today : dates.to;
  // Only the months shown: this one, and for a past month's usual the year before it.
  const categoriesFrom = running ? dates.from : `${shiftMonth(month, -USUAL_MONTHS)}-01`;
  const categories = useGetBankTransactionBreakdown(
    'month',
    'category',
    categoriesFrom,
    end,
    today,
  );
  const sources = useGetBankTransactionBreakdown('month', 'source', dates.from, end, today);
  const sameDay = useGetBankTransactionSummary(month, today, {enabled: running});

  // A failed refresh keeps what is loaded; only a part that never loaded fails the month.
  const failed = [
    categories.isError && !categories.breakdown && categories,
    sources.isError && !sources.breakdown && sources,
    running && sameDay.isError && !sameDay.summary && sameDay,
  ].filter((part) => part !== false);
  if (isError || failed.length > 0)
    return (
      <LoadErrorState
        size='section'
        title="Couldn't load this month"
        error={isError ? error : failed[0]?.error}
        onRetry={() => Promise.all([isError && refetch(), ...failed.map((part) => part.refetch())])}
      />
    );
  if (overview && !point)
    return <p className='text-sm text-muted-foreground'>No history for {formatMonth(month)}.</p>;

  // Each part shows once its own data is in, in a placeholder of its loaded size until then, and only in the
  // history's currency: a part read on the other side of a currency change waits for its refetch.
  const currency = overview?.currency ?? null;
  const inCurrency = <T extends {baseCurrency: string | null}>(response: T | undefined) =>
    response?.baseCurrency === currency ? response : undefined;
  const categoryBreakdown = inCurrency(categories.breakdown);
  const sourceBreakdown = inCurrency(sources.breakdown);
  const sameDaySummary = inCurrency(sameDay.summary);
  const periodOf = (periods: BankTransactionBreakdownPeriod[]) =>
    periods.find((period) => period.start.slice(0, 7) === month);
  const earlier = (categoryBreakdown?.periods ?? []).filter((period) => {
    const start = period.start.slice(0, 7);
    return start < month && start >= shiftMonth(month, -USUAL_MONTHS);
  });
  const sameDayUsual = new Map(
    (sameDaySummary?.baseline.months.length === SAME_DAY_USUAL_MONTHS
      ? sameDaySummary.categories
      : []
    ).map((category) => [
      category.category as string,
      category.baselineAverage === null ? null : toCents(category.baselineAverage),
    ]),
  );
  // No usual without a full window of history before the month.
  const usualOf = running
    ? (key: string) => sameDayUsual.get(key) ?? null
    : (key: string) =>
        earlier.length < USUAL_MONTHS
          ? null
          : earlier.reduce((sum, period) => sum + partCents(period, key), 0) / USUAL_MONTHS;
  const usualReady = !running || sameDaySummary !== undefined;

  return (
    <div className='grid gap-6'>
      <div className='grid gap-2'>
        <MonthFigures point={point} overview={overview} running={running} />
        <MissingAmounts from={dates.from} to={end} />
      </div>

      <div className='grid gap-6 @[1000px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]'>
        <div className='grid min-w-0 content-start gap-6'>
          {overview && categoryBreakdown && usualReady ? (
            <WhereItWent
              period={periodOf(categoryBreakdown.periods)}
              usualOf={usualOf}
              usualLabel={
                running
                  ? `usual by this day, last ${SAME_DAY_USUAL_MONTHS} months`
                  : `usual, last ${USUAL_MONTHS} months`
              }
              currency={currency}
              from={dates.from}
              to={end}
            />
          ) : (
            <PartsSkeleton title='Where it went' rows={6} className='sm:p-6' />
          )}
          <MonthTransactions from={dates.from} to={end} />
        </div>
        <div className='grid min-w-0 content-start gap-6'>
          {overview && sourceBreakdown ? (
            <WhereItCameFrom
              period={periodOf(sourceBreakdown.periods)}
              currency={currency}
              from={dates.from}
              to={end}
            />
          ) : (
            <PartsSkeleton title='Where it came from' rows={2} />
          )}
          <BiggestMerchants month={month} today={today} />
        </div>
      </div>
    </div>
  );
}

/** What came in and went out, what was kept and the balance; the labels stand while the figures load. */
function MonthFigures({
  point,
  overview,
  running,
}: {
  point: MonthPoint | undefined;
  overview: Overview | null;
  running: boolean;
}) {
  const labels = {
    kept: running ? 'Kept so far' : 'Kept',
    balance: running ? 'Balance now' : 'Balance at month end',
  };
  if (!overview || !point)
    return (
      // The same four cells as loaded, in the same order, so each fills in where it stands.
      <FigureCells loading>
        <Figure label='In' value={null} />
        <Figure label='Out' value={null} />
        <Figure label={labels.kept} value={null} sub={<TextBone className='w-[5em]' />} />
        <Figure label={labels.balance} value={null} sub={<TextBone className='w-[7em]' />} />
      </FigureCells>
    );
  const currency = overview.currency;
  const index = overview.months.indexOf(point);
  const before = index > 0 ? overview.months[index - 1] : null;
  const share = point.income > 0 ? point.kept / point.income : null;
  const balanceChange =
    before?.balance != null && point.balance !== null ? point.balance - before.balance : null;
  return (
    <FigureCells>
      <Figure label='In' value={wholeCents(point.income, currency)} tone='text-success' />
      <Figure label='Out' value={wholeCents(point.spending, currency)} />
      <Figure
        label={labels.kept}
        value={signed(point.kept, currency)}
        tone={point.kept < 0 ? 'text-warning' : undefined}
        sub={share === null ? undefined : `${pct(share)} of in`}
      />
      <Figure
        label={labels.balance}
        value={wholeCents(point.balance, currency)}
        sub={
          before && balanceChange !== null ? (
            <>
              <span className='whitespace-nowrap'>{signed(balanceChange, currency)}</span> on{' '}
              {formatMonth(before.month, 'MMM')}
            </>
          ) : undefined
        }
      />
    </FigureCells>
  );
}

/**
 * The month's rows its In and Out leave out for want of an amount in the reporting currency, linked to the list of
 * them. Nothing while every row is counted.
 */
function MissingAmounts({from, to}: {from: string; to: string}) {
  const {totals} = useGetBankTransactionTotals(from, to);
  if (!totals?.baseCurrency || totals.excluded.missingBaseAmount === 0) return null;
  return (
    <Link
      to='/bank-transactions'
      search={{...periodDrill(from, to), baseAmount: 'MISSING'}}
      className='inline-flex items-center gap-1.5 justify-self-start text-sm text-warning underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
      data-testid='month-missing-base-amounts-link'
    >
      <CircleAlert aria-hidden='true' className='size-3.5 shrink-0' />
      {missingAmountsLabel(totals.excluded.missingBaseAmount, totals.baseCurrency)}
    </Link>
  );
}

/** One card in four cells, split by hairlines: two by two on a phone, one row when there is room. */
function FigureCells({loading, children}: {loading?: boolean; children: ReactNode}) {
  return (
    <section
      aria-label='The month'
      aria-busy={loading || undefined}
      className='grid grid-cols-2 gap-px overflow-hidden rounded-card border bg-border @[760px]:grid-cols-4'
    >
      {children}
      {loading && <LoadingLabel>Loading the month</LoadingLabel>}
    </section>
  );
}

/** A month's parts (categories or sources) while they load: the title and rows at their loaded height. */
function PartsSkeleton({
  title,
  rows,
  className,
}: {
  title: string;
  rows: number;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      aria-busy='true'
      className={cn('grid gap-3 rounded-card border bg-card p-5', className)}
    >
      <LoadingLabel>{`Loading ${title.toLowerCase()}`}</LoadingLabel>
      <h2 className='text-card-title'>{title}</h2>
      <ul aria-hidden='true' className='-mx-2 grid gap-1'>
        {Array.from({length: rows}, (_, index) => (
          <li key={index} className='flex min-h-11 items-center gap-3 px-2 text-sm'>
            <Bone className='size-5' />
            <TextBone className='w-[8em]' />
            <Bone className='h-3 flex-1 max-sm:hidden' />
            <TextBone className='ml-auto w-[4em]' />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Figure({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  /** Null while it loads. */
  value: string | null;
  tone?: string;
  sub?: ReactNode;
}) {
  return (
    <div className='min-w-0 bg-card p-3 @[24rem]:p-4 @[40rem]:p-5'>
      <p className='text-label text-muted-foreground'>{label}</p>
      {/* On a phone a long amount steps down a size, so it stays whole in its half of the card. */}
      <p
        className={cn(
          'numeric text-2xl font-semibold whitespace-nowrap @max-[30rem]:text-lg',
          value !== null && value.length > 10 && '@max-[30rem]:text-base',
          tone,
        )}
      >
        {value ?? <TextBone className='w-[4.5em]' />}
      </p>
      {sub && <p className='numeric text-xs text-muted-foreground'>{sub}</p>}
    </div>
  );
}

/** Each category's amount as a bar, with a tick at its usual. */
function WhereItWent({
  period,
  usualOf,
  usualLabel,
  currency,
  from,
  to,
}: {
  period: BankTransactionBreakdownPeriod | undefined;
  usualOf: (key: string) => number | null;
  /** What the usual is, beside its legend line. */
  usualLabel: string;
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
    <section
      aria-label='Where it went'
      className='grid gap-3 rounded-card border bg-card p-5 sm:p-6'
    >
      <header className='flex flex-wrap items-baseline justify-between gap-x-3'>
        <h2 className='text-card-title'>Where it went</h2>
        {hasUsual && (
          // The bars and their ticks are hidden on a phone, where each row reads "on usual" instead.
          <span className='inline-flex items-center gap-1.5 text-xs text-muted-foreground max-sm:hidden'>
            <i aria-hidden='true' className='h-5 w-0.5 bg-foreground' /> {usualLabel}
          </span>
        )}
      </header>
      {parts.length === 0 && <p className='text-sm text-muted-foreground'>No spending.</p>}
      <ul className='-mx-2 grid gap-1'>
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
                className='grid min-h-11 grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-3 px-2 text-sm hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring max-sm:grid-cols-[minmax(0,1fr)_auto]'
              >
                <CategoryName category={part.key} />
                <span aria-hidden='true' className='relative block h-3 bg-muted max-sm:hidden'>
                  {/* The quieter series with its outline, so the usual's foreground line reads across it. */}
                  <span
                    data-mark='amount'
                    className='absolute inset-y-0 left-0 border border-chart-secondary-edge bg-chart-secondary'
                    style={{width: `${(value / max) * 100}%`}}
                  />
                  {usual !== null && usual > 0 && (
                    <span
                      data-mark='usual'
                      className='absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-foreground'
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
  const query = useGetMonthTransactions(from, to);
  const {data, isPending, error, refetch} = query;
  const transactions = data?.pages.flatMap((page) => page.transactions) ?? [];
  return (
    <section aria-label='Transactions' className='min-w-0 rounded-card border bg-card'>
      <header className='flex items-center justify-between gap-3 px-5 pt-3 pb-1'>
        <h2 className='text-card-title'>Transactions</h2>
        <TextAction asChild className='-mr-2'>
          <Link to='/bank-transactions' search={periodDrill(from, to)}>
            Open in Transactions
          </Link>
        </TextAction>
      </header>
      {isPending ? (
        <div aria-busy='true'>
          <LoadingLabel>Loading transactions</LoadingLabel>
          <ul aria-hidden='true' className='divide-y divide-border/60 px-2 pb-2'>
            <TileRowsSkeleton count={5} />
          </ul>
        </div>
      ) : !data ? (
        <div className='px-5 pb-5'>
          <LoadErrorState
            size='section'
            title="Couldn't load transactions"
            error={error}
            onRetry={refetch}
          />
        </div>
      ) : transactions.length === 0 ? (
        <p className='px-5 pb-5 text-sm text-muted-foreground'>No transactions this month.</p>
      ) : (
        <>
          <ul className='divide-y divide-border/60 px-2 pb-2'>
            {transactions.map((transaction) => (
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
          <LoadMore query={query} />
        </>
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
    <section aria-label='Where it came from' className='grid gap-3 rounded-card border bg-card p-5'>
      <h2 className='text-card-title'>Where it came from</h2>
      {parts.length === 0 && <p className='text-sm text-muted-foreground'>No income.</p>}
      <ul className='-mx-2 grid gap-1'>
        {top.map((part) => (
          <li key={part.key}>
            <Link
              to='/bank-transactions'
              search={sourceDrill(part.key, from, to, missingBaseAmounts)}
              className='grid min-h-11 grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-3 px-2 text-sm hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
            >
              {/* The tile sits beside the name, as a category's icon does; the bar runs under the name. */}
              <span className='grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2'>
                <SourceTile source={part} />
                <span className='truncate'>{part.label}</span>
                <span aria-hidden='true' className='col-start-2 mt-1 block h-1 bg-muted'>
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
  const {ranking, isPending, error, refetch} = useGetMerchantRanking(
    'month',
    `${month}-01`,
    asOf,
    MERCHANTS,
  );
  const navigate = useNavigate({from: '/'});
  const open = (merchant: string) =>
    void navigate({search: (prev) => ({...prev, merchants: 'open', merchant})});
  return (
    <section aria-label='Biggest merchants' className='grid gap-3 rounded-card border bg-card p-5'>
      <h2 className='text-card-title'>Biggest merchants</h2>
      {isPending ? (
        <div aria-busy='true'>
          <LoadingLabel>Loading merchants</LoadingLabel>
          <ul aria-hidden='true' className='-mx-3 -mb-3 divide-y divide-border/60'>
            <TileRowsSkeleton count={5} />
          </ul>
        </div>
      ) : !ranking ? (
        // A failed refresh keeps the loaded ranking.
        <LoadErrorState
          size='section'
          title="Couldn't load merchants"
          error={error}
          onRetry={refetch}
        />
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
