import {Link} from '@tanstack/react-router';
import {History, Landmark} from 'lucide-react';
import {type ReactNode, useState, useSyncExternalStore} from 'react';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {LoadErrorState, StateMessage} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Sheet, SheetContent, SheetTitle} from '@/components/ui/sheet';
import {TooltipProvider} from '@/components/ui/tooltip';
import {useGetAllBankConnections} from '@/features/banking/api/use-get-all-bank-connections';
import {isConnectedBank} from '@/features/banking/utils/bank-sync-status';
import {HeatTable, HeatTableSkeleton} from '@/features/dashboard/components/heat-table';
import {YearTable, YearTableSkeleton} from '@/features/dashboard/components/year-table';
import {formatMonth, monthDates} from '@/features/dashboard/utils/month';
import {yearColumnWidth} from '@/features/dashboard/utils/overview';
import {
  reportingCurrencyKnown,
  useReportingCurrency,
} from '@/features/reporting-currency/api/use-reporting-currency';
import {
  RecalculatingTotals,
  ReportingCurrencySetup,
} from '@/features/reporting-currency/components/reporting-currency-setup';
import {useIsMobile} from '@/hooks/use-is-mobile';
import {useLocalDate} from '@/hooks/use-local-date';

import {useInsightsHistory} from '../api/use-insights-history';
import type {InsightsSearch} from '../types/insights-search';
import {monthPageHref} from '../utils/insights-links';
import {formatPeriodSpan, periodMonths, periodOptions} from '../utils/insights-period';
import {buildMoneyFlow} from '../utils/money-flow';
import {
  categoryRows,
  flowTotals,
  sliceOverview,
  sumParts,
  yearPeriods,
} from '../utils/period-figures';
import {CashFlowCard, type FlowBar} from './cash-flow-card';
import {CategoryList} from './category-list';
import {
  AllMerchantsPanel,
  BalanceCard,
  BillsCard,
  MerchantPanel,
  TopMerchants,
} from './insights-rail';
import {MoneyFlowView} from './money-flow';
import {PeriodPicker} from './period-picker';

/** Monthly bars up to this many months; a longer period is drawn by year. */
const MONTH_BARS = 24;

/** The rail stands beside the page from here; narrower, it follows the page and details open in a sheet. */
const RAIL_QUERY = '(min-width: 80rem)';
let railQuery: MediaQueryList | undefined;
const subscribeRail = (onChange: () => void) => {
  railQuery ??= matchMedia(RAIL_QUERY);
  railQuery.addEventListener('change', onChange);
  return () => railQuery?.removeEventListener('change', onChange);
};
const useRailBeside = () =>
  useSyncExternalStore(subscribeRail, () => (railQuery ??= matchMedia(RAIL_QUERY)).matches);

export type InsightsNavigation = {
  /** Pushes a new period, so Back returns to the one before. */
  setPeriod: (period: string) => void;
  /** The rest replace the entry: the view and the rail are part of looking at one period. */
  setSearch: (search: Partial<InsightsSearch>) => void;
};

/**
 * Cash flow over one period kept in the address: In, Out and Kept with monthly bars or the year and heat tables,
 * where the money went, and the categories. The rail holds top merchants, bills and the balance, and opens a
 * merchant's details in place (in a sheet below the rail's width).
 */
export function InsightsPage({
  search,
  navigation,
}: {
  search: InsightsSearch;
  navigation: InsightsNavigation;
}) {
  const reporting = useReportingCurrency();
  return (
    // One provider for the page, so moving between figures shows the next tip without a new delay.
    <TooltipProvider delayDuration={300}>
      <AppBodyLayout>
        {reportingCurrencyKnown(reporting) ? (
          <InsightsBody search={search} navigation={navigation} />
        ) : (
          <PageTitle />
        )}
      </AppBodyLayout>
    </TooltipProvider>
  );
}

function InsightsBody({
  search,
  navigation,
}: {
  search: InsightsSearch;
  navigation: InsightsNavigation;
}) {
  const {bankConnections, isError, error, refetch} = useGetAllBankConnections();
  const {data: reporting} = useReportingCurrency();
  const title = <PageTitle />;
  if (isError)
    return (
      <>
        {title}
        <LoadErrorState title="Couldn't load your banks" error={error} onRetry={refetch} />
      </>
    );
  const connections = bankConnections?.filter(isConnectedBank);
  if (connections?.length === 0)
    return (
      <>
        {title}
        <StateMessage
          icon={Landmark}
          title='Connect a bank to see your cash flow'
          description='What came in, what went out and where it went, once one account has synced.'
        >
          <Button asChild>
            <Link to='/accounts'>Connect a bank</Link>
          </Button>
        </StateMessage>
      </>
    );
  if (reporting?.setupRequired && reporting.currency === null)
    return (
      <>
        {title}
        <ReportingCurrencySetup />
      </>
    );
  if (reporting?.recalculating)
    return (
      <>
        {title}
        <RecalculatingTotals currency={reporting.currency} />
      </>
    );
  return <InsightsReport search={search} navigation={navigation} />;
}

function InsightsReport({
  search,
  navigation,
}: {
  search: InsightsSearch;
  navigation: InsightsNavigation;
}) {
  const today = useLocalDate();
  const thisMonth = today.slice(0, 7);
  const history = useInsightsHistory(today);
  const {overview, breakdowns} = history;
  const firstMonth = overview?.months[0]?.month ?? thisMonth;
  const {period, from, to} = periodMonths(search.period?.toString(), firstMonth, thisMonth);
  const options = periodOptions(firstMonth, thisMonth);
  const periodLabel = options.find((option) => option.value === period)!.label;
  const end = monthDates(to).to;
  const range = {from: `${from}-01`, to: end < today ? end : today};
  const sliced = overview ? sliceOverview(overview, from, to) : null;
  const figures = sliced ? flowTotals(sliced.months) : null;
  const currency = overview?.currency ?? null;
  const byYear = (sliced?.months.length ?? 0) > MONTH_BARS;
  const bars: FlowBar[] | null = sliced
    ? byYear
      ? sliced.years.map((year) => ({
          key: year.year,
          tick: year.year,
          name: year.year,
          income: year.income,
          spending: year.spending,
          complete: year.months.every((point) => point.complete),
          href: `?period=${year.year}`,
          onOpen: () => navigation.setPeriod(year.year),
        }))
      : sliced.months.map((point) => ({
          key: point.month,
          tick: formatMonth(point.month, 'MMM'),
          name: formatMonth(point.month),
          income: point.income,
          spending: point.spending,
          complete: point.complete,
          href: monthPageHref(point.month, period),
        }))
    : null;
  const flow =
    figures && breakdowns
      ? buildMoneyFlow({
          income: figures.income,
          spending: figures.spending,
          sources: sumParts(breakdowns.sources, from, to),
          categories: sumParts(breakdowns.categories, from, to),
        })
      : undefined;
  const categories = breakdowns ? categoryRows(breakdowns.categories, from, to) : null;
  const lastMonth = sliced?.months[sliced.months.length - 1];

  const railBeside = useRailBeside();
  const phone = useIsMobile();
  // Kept here, so a merchant opened from the list and closed again finds the list as it was.
  const [merchantSearch, setMerchantSearch] = useState('');
  const closeRail = () => {
    setMerchantSearch('');
    navigation.setSearch({merchant: undefined, merchants: undefined});
  };
  const selectMerchant = (merchant: string) => navigation.setSearch({merchant});
  const detail = search.merchant ? (
    <MerchantPanel
      id={search.merchant}
      onBack={search.merchants ? () => navigation.setSearch({merchant: undefined}) : undefined}
      onClose={closeRail}
    />
  ) : search.merchants ? (
    <AllMerchantsPanel
      range={range}
      periodLabel={periodLabel}
      onSelect={selectMerchant}
      onClose={closeRail}
      searchInput={merchantSearch}
      onSearchInputChange={setMerchantSearch}
    />
  ) : null;
  const idleRail = (
    <>
      <TopMerchants
        range={overview ? range : null}
        onSelect={selectMerchant}
        onAll={() => navigation.setSearch({merchants: 'all'})}
      />
      <BillsCard today={today} />
      <BalanceCard
        balance={sliced ? (lastMonth?.balance ?? null) : undefined}
        end={lastMonth?.end}
        running={lastMonth?.end === today}
        currency={currency}
      />
    </>
  );

  if (history.isError)
    return (
      <>
        <PageTitle />
        <LoadErrorState
          title="Couldn't load your history"
          error={history.error}
          onRetry={history.refetch}
        />
      </>
    );
  if (overview?.months.length === 0)
    return (
      <>
        <PageTitle />
        <StateMessage
          icon={History}
          title='No history yet'
          description='Your cash flow appears here once the first transactions have synced.'
        />
      </>
    );

  return (
    <div className='grid gap-4'>
      <header className='grid gap-1'>
        <h1 className='text-page-title'>Insights</h1>
        <p className='text-body-small text-muted-foreground'>
          {overview ? formatPeriodSpan(from, to) : ' '}
        </p>
      </header>
      <PeriodPicker options={options} value={period} onChange={navigation.setPeriod} />
      <div className='grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]'>
        <div className='grid min-w-0 gap-3'>
          <CashFlowCard
            figures={figures}
            currency={currency}
            bars={bars}
            unit={byYear ? 'year' : 'month'}
            view={search.view === 'table' ? 'table' : 'chart'}
            onViewChange={(view) =>
              navigation.setSearch({view: view === 'table' ? 'table' : undefined})
            }
          />
          {search.view === 'table' && (
            <PeriodTables
              sliced={sliced}
              breakdowns={breakdowns}
              from={from}
              to={to}
              error={history.breakdownsError}
              onRetry={history.refetchBreakdowns}
            />
          )}
          <Section title='Where the money went' loaded={flow !== undefined}>
            {flow === undefined && history.breakdownsError ? (
              <LoadErrorState
                size='section'
                title="Couldn't load where the money went"
                error={history.breakdownsError}
                onRetry={history.refetchBreakdowns}
              />
            ) : flow === undefined ? (
              <div aria-hidden='true' className='h-60 animate-pulse rounded-md bg-muted' />
            ) : flow === null ? (
              <p className='text-body-small text-muted-foreground'>
                Nothing came in or went out in this period.
              </p>
            ) : (
              <MoneyFlowView flow={flow} currency={currency} />
            )}
          </Section>
          {categories ? (
            <CategoryList
              rows={categories}
              currency={currency}
              period={period}
              periodLabel={periodLabel}
            />
          ) : history.breakdownsError ? (
            <LoadErrorState
              title="Couldn't load spending by category"
              error={history.breakdownsError}
              onRetry={history.refetchBreakdowns}
            />
          ) : (
            <Section title='Categories' loaded={false}>
              <div aria-hidden='true' className='h-72 animate-pulse rounded-md bg-muted' />
            </Section>
          )}
        </div>
        {railBeside ? (
          <aside
            aria-label={detail ? (search.merchant ? 'Merchant' : 'Merchants') : 'Insights rail'}
            className='grid min-w-0 gap-3'
          >
            {detail ? <Card className='p-4'>{detail}</Card> : idleRail}
          </aside>
        ) : (
          <aside aria-label='Insights rail' className='grid min-w-0 gap-3'>
            {idleRail}
          </aside>
        )}
      </div>
      {!railBeside && (
        <Sheet
          open={!!detail}
          onOpenChange={(open) => {
            if (!open) closeRail();
          }}
        >
          <SheetContent
            side={phone ? 'bottom' : 'right'}
            aria-describedby={undefined}
            className='w-full overflow-y-auto sm:max-w-md [&>button:last-child]:hidden'
          >
            <SheetTitle className='sr-only'>
              {search.merchant ? 'Merchant' : 'Merchants'}
            </SheetTitle>
            {detail}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/** The title over a state that stands in for the report. */
function PageTitle() {
  return <h1 className='mb-5 text-page-title max-md:mb-4'>Insights</h1>;
}

function Section({title, loaded, children}: {title: string; loaded: boolean; children: ReactNode}) {
  return (
    <Card
      role='region'
      aria-label={title}
      aria-busy={!loaded || undefined}
      className='grid min-w-0 gap-4 p-4'
    >
      <h2 className='text-card-title'>{title}</h2>
      {children}
    </Card>
  );
}

/** Behind Table: the period's years and months, and its spending and income by year. */
function PeriodTables({
  sliced,
  breakdowns,
  from,
  to,
  error,
  onRetry,
}: {
  sliced: ReturnType<typeof sliceOverview> | null;
  breakdowns: ReturnType<typeof useInsightsHistory>['breakdowns'];
  from: string;
  to: string;
  error: unknown;
  onRetry: () => void;
}) {
  const years = breakdowns
    ? {
        categories: yearPeriods(breakdowns.categories, from, to),
        sources: yearPeriods(breakdowns.sources, from, to),
      }
    : null;
  if (!sliced) return <YearTableSkeleton />;
  const columnWidth = years
    ? yearColumnWidth([...years.categories, ...years.sources], sliced.months, sliced.currency)
    : '';
  return (
    <>
      <YearTable key={`${from}-${to}`} overview={sliced} />
      {years ? (
        <>
          <HeatTable
            title='Spending by category'
            periods={years.categories}
            months={sliced.months}
            currency={sliced.currency}
            kind='category'
            columnWidth={columnWidth}
          />
          <HeatTable
            title='Income by source'
            periods={years.sources}
            months={sliced.months}
            currency={sliced.currency}
            kind='source'
            columnWidth={columnWidth}
          />
        </>
      ) : error ? (
        <LoadErrorState
          title="Couldn't load spending and income by year"
          error={error}
          onRetry={onRetry}
        />
      ) : (
        <>
          <HeatTableSkeleton title='Spending by category' kind='category' />
          <HeatTableSkeleton title='Income by source' kind='source' />
        </>
      )}
    </>
  );
}
