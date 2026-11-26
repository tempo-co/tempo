import type {RecurringSeries, RecurringSeriesList, RecurringSeriesLists} from '@tempo/contracts';
import {format} from 'date-fns';
import {
  CalendarClock,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  Clock,
  List,
  Repeat,
} from 'lucide-react';
import type React from 'react';
import {useEffect} from 'react';

import {LoadErrorState, StateMessage} from '@/components/shared/state-message';
import {TextAction} from '@/components/shared/text-action';
import {Card} from '@/components/ui/card';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Skeleton} from '@/components/ui/skeleton';
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {parseCalendarDate} from '@/features/dashboard/utils/drill-links';
import {formatMoney, formatWholeMoney, toCents} from '@/features/dashboard/utils/money';
import {useFiguresCurrencyAccepted} from '@/features/reporting-currency/api/use-reporting-currency';
import {useIsWide} from '@/hooks/use-is-wide';
import {cn} from '@/utils/cn';
import {savedDataStatus} from '@/utils/query-status';

import {useGetRecurringSeries} from '../api/use-get-recurring-series';
import type {RecurringSearch} from '../types/recurring-search';
import {RECURRING_CADENCE_LABELS} from '../types/recurring-series';
import {
  formatAmount,
  formatMonthlyEquivalent,
  formatPriceChange,
  isCounted,
} from '../utils/recurring-format';
import {
  type CalendarItem,
  MONTH_KIND_LABELS,
  type MonthEntry,
  type MonthGroup,
  calendarItems,
  monthGroups,
  notThisMonth,
  seriesFlags,
} from '../utils/recurring-month';
import {RecurringCalendar} from './recurring-calendar';
import {RecurringSeriesDetail} from './recurring-series-detail';
import {RecurringSeriesRow} from './recurring-series-row';

type Open = (key: string) => void;

/** A card as a section of its own; `Card` cannot take another element. */
const CARD = 'rounded-lg border bg-card text-card-foreground';

const day = (date: string) => format(parseCalendarDate(date), 'd MMM');

/**
 * This month's bills by status or on a calendar, and every series on All recurring. A series opens in the rail
 * beside them, or a sheet on narrower screens.
 */
export function RecurringPage({
  asOf,
  search,
  onChange,
}: {
  asOf: string;
  search: RecurringSearch;
  onChange: (next: Partial<RecurringSearch>) => void;
}) {
  const query = useGetRecurringSeries(asOf);
  const {isPending, isError} = savedDataStatus(query);
  const lists = query.data;
  const wide = useIsWide();
  const all = lists ? [...lists.expenses.series, ...lists.income.series] : [];
  const selected = all.find(({key}) => key === search.series);
  // An unlink replaces the open series with its two histories; the list shows them, and an undo
  // that brings the series back does not reopen it.
  useEffect(() => {
    if (lists && search.series && !selected) onChange({series: undefined});
  }, [lists, selected, search.series, onChange]);

  const accepted = useFiguresCurrencyAccepted();
  // Lists read mid-conversion or in another currency wait for their refetch; empty ones have nothing to label.
  const waiting =
    !!lists &&
    [lists.expenses, lists.income].some(
      (list) => list.series.length > 0 && !accepted(list.baseCurrency),
    );
  if (isPending || waiting) return <RecurringSkeleton />;
  if (isError || !lists) {
    return (
      <LoadErrorState
        title="Couldn't load recurring payments"
        error={query.error}
        onRetry={() => query.refetch()}
      />
    );
  }
  if (all.length === 0) {
    return (
      <StateMessage
        icon={Repeat}
        title='No recurring payments found yet'
        description='Payments to the same place on a regular rhythm show up here. A yearly payment of the same amount counts after two payments, unless both are everyday shopping, it goes to a person, or you pay that payee often in between; other patterns need at least three.'
      />
    );
  }

  const open: Open = (key) => onChange({series: key});
  const close = () => onChange({series: undefined});
  const selectedKey = selected?.key ?? null;
  const baseCurrency = lists.expenses.baseCurrency;
  const tab = search.tab === 'all' ? 'all' : 'month';
  const details = selected && (
    <RecurringSeriesDetail
      // A new series starts with its own payments and chart, not the last one's.
      key={selected.key}
      series={selected}
      baseCurrency={baseCurrency}
      asOf={asOf}
      onClose={close}
    />
  );

  return (
    <div className='grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_--spacing(90)] lg:items-start'>
      <div className='grid min-w-0 grid-cols-1 gap-3'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <Tabs
            value={tab}
            onValueChange={(next) => onChange({tab: next === 'all' ? 'all' : undefined})}
          >
            <TabsList>
              <TabsTrigger value='month'>This month</TabsTrigger>
              <TabsTrigger value='all'>
                All recurring
                <span className='numeric font-normal text-muted-foreground'>{all.length}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {tab === 'month' && (
            <ToggleGroup
              type='single'
              variant='outline'
              size='sm'
              value={search.view ?? 'list'}
              onValueChange={(next) => {
                if (next) onChange({view: next === 'calendar' ? 'calendar' : undefined});
              }}
              aria-label='Show this month as'
            >
              {(
                [
                  ['list', 'List', List],
                  ['calendar', 'Calendar', CalendarDays],
                ] as const
              ).map(([value, label, Icon]) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  className='rounded-sm px-3 text-body-small data-[state=on]:bg-secondary data-[state=on]:font-semibold data-[state=on]:text-secondary-foreground max-sm:min-h-11 pointer-coarse:min-h-11'
                >
                  <Icon aria-hidden />
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </div>
        {tab === 'all' ? (
          <Catalogue lists={lists} asOf={asOf} selectedKey={selectedKey} onOpen={open} />
        ) : (
          <ThisMonth
            lists={lists}
            asOf={asOf}
            calendar={search.view === 'calendar'}
            selectedKey={selectedKey}
            onOpen={open}
          />
        )}
      </div>
      <aside
        aria-label={selected ? undefined : 'About your bills'}
        className='grid min-w-0 grid-cols-1 gap-3'
      >
        {wide && details ? (
          <Card className='p-4'>{details}</Card>
        ) : (
          <Idle
            lists={lists}
            selectedKey={selectedKey}
            onOpen={open}
            onShowAll={() => onChange({tab: 'all'})}
          />
        )}
      </aside>
      {!wide && (
        <ResponsiveDialog
          open={!!details}
          onOpenChange={(next) => {
            if (!next) close();
          }}
        >
          <ResponsiveDialogContent
            aria-label='Recurring payment'
            className='flex h-[min(90dvh,--spacing(224))] max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-h-[90vh] sm:max-w-xl [&>button:last-child]:hidden'
          >
            <ResponsiveDialogTitle className='sr-only'>
              {selected?.name ?? 'Recurring payment'}
            </ResponsiveDialogTitle>
            {/* Radix wraps content in a display:table div that grows to its widest row; keep it at the sheet's width. */}
            <ScrollArea
              type='always'
              className='min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block'
            >
              {/* On phones a toast sits above where the tab bar is; the last actions scroll clear of it. */}
              <div className='p-5 max-md:pb-[calc(--spacing(36)+env(safe-area-inset-bottom))] sm:p-6'>
                {details}
              </div>
            </ScrollArea>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}
    </div>
  );
}

/** An amount in the base currency where the API gave one, otherwise the series' own; a due estimate gets "≈". */
function entryAmount(
  series: RecurringSeries,
  cents: number | null,
  estimate: boolean,
  baseCurrency: string | null,
) {
  if (cents === null) return formatAmount(series);
  return `${estimate && series.amountKind === 'VARIABLE' ? '≈ ' : ''}${formatMoney(cents / 100, baseCurrency)}`;
}

/** Each group's heading and how a row in it words its date: "expected 5 Oct", or "2 late, since 2 Oct". */
const GROUPS = {
  late: {title: 'Late', icon: Clock, single: 'expected', counted: 'late', since: 'since'},
  coming: {
    title: 'Coming up',
    icon: CalendarClock,
    single: 'next',
    counted: 'to come',
    since: 'next',
  },
  paid: {title: 'Paid', icon: CircleCheck, single: 'paid', counted: 'paid', since: 'last'},
} as const;

function ThisMonth({
  lists,
  asOf,
  calendar,
  selectedKey,
  onOpen,
}: {
  lists: RecurringSeriesLists;
  asOf: string;
  calendar: boolean;
  selectedKey: string | null;
  onOpen: Open;
}) {
  const baseCurrency = lists.expenses.baseCurrency;
  const groups = monthGroups(lists).filter(({entries}) => entries.length > 0);
  return (
    <>
      <MonthFigures lists={lists} />
      {calendar ? (
        <RecurringCalendar
          asOf={asOf}
          items={calendarItems(lists)}
          formatItemAmount={({series, cents, kind}: CalendarItem) =>
            entryAmount(series, cents, kind !== 'paid', baseCurrency)
          }
          rowFor={(item) => (
            <RecurringSeriesRow
              series={item.series}
              detail={`${RECURRING_CADENCE_LABELS[item.series.cadence]} · ${MONTH_KIND_LABELS[item.kind]} ${day(item.date)}`}
              amount={entryAmount(item.series, item.cents, item.kind !== 'paid', baseCurrency)}
              flags={[]}
              selected={item.series.key === selectedKey}
              onOpen={onOpen}
            />
          )}
          selectedKey={selectedKey}
          onOpen={onOpen}
        />
      ) : groups.length === 0 ? (
        <p className='text-body-small text-muted-foreground'>
          Nothing recurring is due in {format(parseCalendarDate(asOf), 'MMMM')}.
        </p>
      ) : (
        groups.map((group) => (
          <MonthGroupCard
            key={group.id}
            group={group}
            baseCurrency={baseCurrency}
            selectedKey={selectedKey}
            onOpen={onOpen}
          />
        ))
      )}
    </>
  );
}

/** The month's bills, what is paid and what is still to pay, from the list's own figures. */
function MonthFigures({lists}: {lists: RecurringSeriesLists}) {
  const {expenses, income} = lists;
  const currency = expenses.baseCurrency;
  const paid = toCents(expenses.thisMonth.paid);
  const remaining = toCents(expenses.thisMonth.remaining);
  const total = paid + remaining;
  const incomePaid = toCents(income.thisMonth.paid);
  const incomeRemaining = toCents(income.thisMonth.remaining);
  const monthName = format(parseCalendarDate(`${expenses.thisMonth.month}-01`), 'MMMM');
  const money = (cents: number) => formatMoney(cents / 100, currency);

  return (
    <Card className='grid grid-cols-1 gap-3 p-4' data-testid='recurring-summary'>
      {/* Figures are never cut short: one that does not fit moves to the next line. */}
      <dl className='flex flex-wrap gap-x-6 gap-y-2'>
        {(
          [
            [`Bills in ${monthName}`, total],
            ['Paid', paid],
            ['Still to pay', remaining],
          ] as const
        ).map(([label, cents]) => (
          <div key={label}>
            <dt className='text-body-small text-muted-foreground'>{label}</dt>
            <dd className='numeric text-xl font-semibold tracking-tight whitespace-nowrap sm:text-2xl'>
              {money(cents)}
            </dd>
          </div>
        ))}
      </dl>
      {total > 0 && (
        <div
          className='h-1.5 overflow-hidden rounded-full bg-muted'
          role='img'
          aria-label={`${Math.round((paid / total) * 100)}% of ${monthName}'s bills paid`}
        >
          <div className='h-full bg-chart-primary' style={{width: `${(paid / total) * 100}%`}} />
        </div>
      )}
      {incomePaid + incomeRemaining > 0 && (
        <p className='text-body-small text-muted-foreground'>
          Income <Figure className='text-success'>+{money(incomePaid + incomeRemaining)}</Figure> ·{' '}
          {incomeRemaining > 0 ? (
            <>
              <Figure>{money(incomeRemaining)}</Figure> still to come
            </>
          ) : (
            'all received'
          )}
        </p>
      )}
      {expenses.unconvertedCount > 0 && (
        <p className='text-body-small text-muted-foreground'>
          {expenses.unconvertedCount} not converted yet, left out of the figures.
        </p>
      )}
    </Card>
  );
}

/** An amount inside a sentence: the sentence may wrap, the amount stays whole. */
function Figure({children, className}: {children: React.ReactNode; className?: string}) {
  return <span className={cn('numeric whitespace-nowrap', className)}>{children}</span>;
}

function entryDetail({series, date, count}: MonthEntry, id: MonthGroup['id']) {
  const rhythm = RECURRING_CADENCE_LABELS[series.cadence];
  const {single, counted, since} = GROUPS[id];
  if (count === 1) return `${rhythm} · ${single} ${day(date)}`;
  return `${rhythm} · ${count} ${counted}, ${since} ${day(date)}`;
}

function MonthGroupCard({
  group,
  baseCurrency,
  selectedKey,
  onOpen,
}: {
  group: MonthGroup;
  baseCurrency: string | null;
  selectedKey: string | null;
  onOpen: Open;
}) {
  const {title, icon: Icon} = GROUPS[group.id];
  return (
    <section aria-label={title} className={cn(CARD, 'overflow-hidden')}>
      <h2
        className={cn(
          'flex items-center justify-between gap-3 px-4 pt-3 pb-1 text-card-title',
          group.id === 'late' && 'text-warning',
        )}
      >
        <span className='inline-flex items-center gap-2'>
          <Icon aria-hidden className='size-4' />
          {title}
        </span>
        {group.entries.some(({series}) => series.direction === 'EXPENSE') && (
          <span className='numeric font-medium text-muted-foreground'>
            {formatMoney(group.billCents / 100, baseCurrency)}
          </span>
        )}
      </h2>
      <ul className='divide-y divide-border/60'>
        {group.entries.map((entry) => (
          <li key={entry.series.key} data-testid={`recurring-series-${entry.series.key}`}>
            <RecurringSeriesRow
              series={entry.series}
              detail={entryDetail(entry, group.id)}
              amount={entryAmount(entry.series, entry.cents, group.id !== 'paid', baseCurrency)}
              flags={seriesFlags(entry.series).filter((flag) => flag === 'pricier')}
              selected={entry.series.key === selectedKey}
              onOpen={onOpen}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every series by direction, with its flags; hidden ones wait in a fold at the end. */
function Catalogue({
  lists,
  asOf,
  selectedKey,
  onOpen,
}: {
  lists: RecurringSeriesLists;
  asOf: string;
  selectedKey: string | null;
  onOpen: Open;
}) {
  return (
    <>
      {(
        [
          ['Bills', lists.expenses],
          ['Income', lists.income],
        ] as const
      ).map(
        ([title, list]) =>
          list.series.length > 0 && (
            <CatalogueCard
              key={title}
              title={title}
              list={list}
              asOf={asOf}
              selectedKey={selectedKey}
              onOpen={onOpen}
            />
          ),
      )}
    </>
  );
}

function CatalogueCard({
  title,
  list,
  asOf,
  selectedKey,
  onOpen,
}: {
  title: string;
  list: RecurringSeriesList;
  asOf: string;
  selectedKey: string | null;
  onOpen: Open;
}) {
  const shown = list.series.filter(({hidden}) => !hidden);
  const hidden = list.series.filter((series) => series.hidden);
  const isIncome = title === 'Income';
  const rows = (series: RecurringSeries[], muted: boolean) => (
    <ul className='divide-y divide-border/60'>
      {series.map((entry) => (
        <li key={entry.key} data-testid={`recurring-series-${entry.key}`}>
          <CatalogueRow
            series={entry}
            baseCurrency={list.baseCurrency}
            asOf={asOf}
            selected={entry.key === selectedKey}
            muted={muted}
            onOpen={onOpen}
          />
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-label={title} className={cn(CARD, 'overflow-hidden')}>
      <h2 className='flex items-center justify-between gap-3 px-4 pt-3 pb-1 text-card-title'>
        {title}
        <span
          className={cn('numeric font-medium text-muted-foreground', isIncome && 'text-success')}
        >
          {isIncome && '+'}
          {formatMoney(list.monthlyTotal, list.baseCurrency)} a month
        </span>
      </h2>
      {rows(shown, false)}
      {list.unconvertedCount > 0 && (
        <p className='border-t px-4 py-2 text-body-small text-muted-foreground'>
          {list.unconvertedCount} not converted yet, left out of the total.
        </p>
      )}
      {hidden.length > 0 && (
        <details className='group border-t' aria-label={`Hidden ${title.toLowerCase()}`}>
          <TextAction
            asChild
            className='mx-2 my-1 cursor-pointer list-none [&::-webkit-details-marker]:hidden'
          >
            <summary>
              <ChevronRight
                aria-hidden
                className='size-4 transition-transform group-open:rotate-90'
              />
              Hidden ({hidden.length})
            </summary>
          </TextAction>
          <div className='border-t'>{rows(hidden, true)}</div>
        </details>
      )}
    </section>
  );
}

function CatalogueRow({
  series,
  baseCurrency,
  asOf,
  selected,
  muted,
  onOpen,
}: {
  series: RecurringSeries;
  baseCurrency: string | null;
  asOf: string;
  selected: boolean;
  muted: boolean;
  onOpen: Open;
}) {
  const rhythm = RECURRING_CADENCE_LABELS[series.cadence];
  const when = !isCounted(series)
    ? `last paid ${day(series.lastDate)}`
    : `${series.nextExpectedDate < asOf ? 'expected' : 'next'} ${format(
        parseCalendarDate(series.nextExpectedDate),
        series.nextExpectedDate.slice(0, 4) === asOf.slice(0, 4) ? 'd MMM' : 'd MMM yyyy',
      )}`;
  const hint = series.priceChange
    ? formatPriceChange(series.priceChange, series.currency)
    : series.amountRange
      ? `${formatMoney(series.amountRange.low, series.currency)}–${formatMoney(series.amountRange.high, series.currency)}`
      : formatMonthlyEquivalent(series, baseCurrency);
  return (
    <RecurringSeriesRow
      series={series}
      detail={`${rhythm} · ${when}`}
      amount={formatAmount(series)}
      hint={hint}
      flags={seriesFlags(series)}
      selected={selected}
      muted={muted}
      onOpen={onOpen}
    />
  );
}

/** Rows "Not this month" shows before pointing to All recurring. */
const LATER_ROWS = 5;

/** Beside the list when no series is open (under it on narrower screens): a year of bills and what skips this month. */
function Idle({
  lists,
  selectedKey,
  onOpen,
  onShowAll,
}: {
  lists: RecurringSeriesLists;
  selectedKey: string | null;
  onOpen: Open;
  onShowAll: () => void;
}) {
  const later = notThisMonth(lists);
  const currency = lists.expenses.baseCurrency;
  return (
    <>
      {toCents(lists.expenses.monthlyTotal) > 0 && (
        <section aria-label='A year of bills' className={cn(CARD, 'grid gap-1 p-4')}>
          <h2 className='text-card-title'>A year of bills</h2>
          <p className='numeric text-2xl font-semibold tracking-tight'>
            {formatWholeMoney(Number(lists.expenses.monthlyTotal) * 12, currency)}
          </p>
        </section>
      )}
      {later.length > 0 && (
        <section aria-label='Not this month' className={cn(CARD, 'overflow-hidden')}>
          <h2 className='px-4 pt-3 pb-1 text-card-title'>Not this month</h2>
          <ul className='divide-y divide-border/60'>
            {later.slice(0, LATER_ROWS).map((series) => (
              <li key={series.key} data-testid={`recurring-later-${series.key}`}>
                <RecurringSeriesRow
                  series={series}
                  detail={`${RECURRING_CADENCE_LABELS[series.cadence]} · next ${format(parseCalendarDate(series.nextExpectedDate), 'd MMM yyyy')}`}
                  amount={formatAmount(series)}
                  flags={[]}
                  selected={series.key === selectedKey}
                  onOpen={onOpen}
                />
              </li>
            ))}
          </ul>
          {later.length > LATER_ROWS && (
            <div className='border-t px-2 py-1'>
              <TextAction onClick={onShowAll}>
                {later.length - LATER_ROWS} more in All recurring
              </TextAction>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function RecurringSkeleton() {
  return (
    <div aria-busy='true' aria-label='Loading recurring payments' className='grid gap-3'>
      <Skeleton className='h-8 w-60' />
      <Skeleton className='h-28' />
      <div className='grid gap-px overflow-hidden rounded-lg border'>
        <Skeleton className='h-15 rounded-none' />
        <Skeleton className='h-15 rounded-none' />
        <Skeleton className='h-15 rounded-none' />
      </div>
    </div>
  );
}
