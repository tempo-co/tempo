import {Link, useNavigate, useRouter} from '@tanstack/react-router';
import type {BankTransactionCategoryFilterValue} from '@tempo/contracts';
import {FileQuestion} from 'lucide-react';
import type {ReactNode} from 'react';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {LoadMore} from '@/components/shared/load-more';
import {LoadErrorState, StateMessage} from '@/components/shared/state-message';
import {TextAction} from '@/components/shared/text-action';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {TooltipProvider} from '@/components/ui/tooltip';
import {useHasMissingBaseAmounts} from '@/features/banking/api/use-get-bank-transaction-review-counts';
import {TransactionListRow} from '@/features/banking/components/transaction-list-row';
import {isBankTransactionCategoryFilterValue} from '@/features/banking/types/bank-transaction';
import {LoadingLabel, TextBone, TileRowsSkeleton} from '@/features/dashboard/components/loading';
import {categoryDrill} from '@/features/dashboard/utils/drill-links';
import {categoryLabel, wholeCents} from '@/features/dashboard/utils/format';
import {formatMoney, toCents} from '@/features/dashboard/utils/money';
import {monthDates} from '@/features/dashboard/utils/month';
import {useGetMerchants} from '@/features/merchants/api/use-get-merchants';
import {MerchantRow} from '@/features/merchants/components/merchant-row';
import {countLabel} from '@/features/merchants/utils/merchant-format';
import {useFiguresCurrencyAccepted} from '@/features/reporting-currency/api/use-reporting-currency';
import {useLocalDate} from '@/hooks/use-local-date';

import {useCategoryTransactions} from '../api/use-category-transactions';
import {useInsightsHistory} from '../api/use-insights-history';
import type {InsightsPeriodSearch} from '../types/insights-search';
import {type CategoryBar, categoryBars} from '../utils/category-figures';
import {periodSearch} from '../utils/insights-links';
import {formatPeriodSpan, periodMonths, periodOptions} from '../utils/insights-period';
import {CategoryBars} from './category-bars';
import {InsightsBackLink} from './insights-back-link';
import {InsightsGate} from './insights-page';
import {PeriodPicker} from './period-picker';

/** Merchants the page lists. */
const TOP = 6;

/**
 * One category at `/insights/categories/<category>` over Insights' period, kept in the address: what was spent each
 * month against a usual month, its biggest merchants and its transactions, with the way to Transactions filtered to
 * it.
 */
export function CategoryPage({category, search}: {category: string; search: InsightsPeriodSearch}) {
  const title = <CategoryTitle category={category} search={search} />;
  return (
    // One provider for the page, so moving between figures shows the next tip without a new delay.
    <TooltipProvider delayDuration={300}>
      <AppBodyLayout>
        {isBankTransactionCategoryFilterValue(category) ? (
          <InsightsGate title={title}>
            <CategoryReport category={category} search={search} />
          </InsightsGate>
        ) : (
          <>
            <InsightsBackLink search={search} />
            <h1 className='mb-5 text-page-title max-md:mb-4'>Category not found</h1>
            <StateMessage
              icon={FileQuestion}
              title='There is no such category'
              description='The address names a category that does not exist.'
            >
              <Button variant='outline' asChild>
                <Link to='/insights' search={search}>
                  Open Insights
                </Link>
              </Button>
            </StateMessage>
          </>
        )}
      </AppBodyLayout>
    </TooltipProvider>
  );
}

function CategoryTitle({
  category,
  search,
  span,
}: {
  category: string;
  search: InsightsPeriodSearch;
  /** The period's months in words, once the history has set them. */
  span?: string;
}) {
  return (
    <header className='grid justify-items-start gap-1'>
      <InsightsBackLink search={search} />
      <h1 className='text-page-title'>{categoryLabel(category)}</h1>
      {span !== undefined && <p className='text-body-small text-muted-foreground'>{span}</p>}
    </header>
  );
}

function CategoryReport({
  category,
  search,
}: {
  category: BankTransactionCategoryFilterValue;
  search: InsightsPeriodSearch;
}) {
  const today = useLocalDate();
  const thisMonth = today.slice(0, 7);
  const history = useInsightsHistory(today);
  const {overview, breakdowns} = history;
  const navigate = useNavigate();
  const router = useRouter();
  const firstMonth = overview?.months[0]?.month ?? thisMonth;
  const {period, from, to} = periodMonths(search.period?.toString(), firstMonth, thisMonth);
  const options = periodOptions(firstMonth, thisMonth);
  const kept = periodSearch(period);
  const end = monthDates(to).to;
  const range = {from: `${from}-01`, to: end < today ? end : today};
  const figures = breakdowns
    ? categoryBars(breakdowns.categories, category, from, to, {
        monthHref: (month) =>
          router.buildLocation({to: '/insights/months/$month', params: {month}, search: kept}).href,
        yearHref: (year) =>
          router.buildLocation({
            to: '/insights/categories/$category',
            params: {category},
            search: periodSearch(year),
          }).href,
      })
    : null;
  const open = (bar: CategoryBar) =>
    void navigate(
      bar.unit === 'month'
        ? {to: '/insights/months/$month', params: {month: bar.key}, search: kept}
        : {
            to: '/insights/categories/$category',
            params: {category},
            search: periodSearch(bar.key),
          },
    );
  const setPeriod = (next: string) =>
    void navigate({
      to: '/insights/categories/$category',
      params: {category},
      search: periodSearch(next),
    });
  const span = overview ? formatPeriodSpan(from, to) : ' ';
  const currency = overview?.currency ?? null;

  if (history.isError || (!breakdowns && history.breakdownsError))
    return (
      <>
        <CategoryTitle category={category} search={search} span={span} />
        <LoadErrorState
          title={`Couldn't load ${categoryLabel(category).toLowerCase()}`}
          error={history.isError ? history.error : history.breakdownsError}
          onRetry={() => Promise.all([history.refetch(), history.refetchBreakdowns()])}
        />
      </>
    );

  return (
    <div className='grid gap-4'>
      <CategoryTitle category={category} search={search} span={span} />
      <PeriodPicker options={options} value={period} onChange={setPeriod} />
      <div className='grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]'>
        <div className='grid min-w-0 gap-3'>
          <Card
            role='region'
            aria-label='Spending'
            aria-busy={!figures || undefined}
            className='grid min-w-0 gap-4 p-4'
          >
            <h2 className='text-card-title'>Spending</h2>
            <dl className='grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-4 gap-y-3'>
              <Figure label='Spent'>{figures && wholeCents(figures.total, currency)}</Figure>
              {(!figures || figures.usual !== null) && (
                <Figure label='A usual month'>
                  {figures?.usual != null && wholeCents(figures.usual, currency)}
                </Figure>
              )}
            </dl>
            {figures ? (
              figures.bars.length > 1 && (
                <CategoryBars
                  bars={figures.bars}
                  usual={figures.unit === 'month' ? figures.usual : null}
                  currency={currency}
                  onOpen={open}
                />
              )
            ) : (
              <div aria-hidden='true' className='h-52 animate-pulse rounded-md bg-muted' />
            )}
          </Card>
          <CategoryTransactions category={category} range={overview ? range : null} />
        </div>
        <aside aria-label='Category rail' className='grid min-w-0 gap-3'>
          <CategoryMerchants
            category={category}
            range={overview ? range : null}
            onSelect={(merchant) => void navigate({to: '/insights', search: {...kept, merchant}})}
          />
        </aside>
      </div>
    </div>
  );
}

function Figure({label, children}: {label: string; children: ReactNode}) {
  return (
    <div data-testid='category-figure' className='min-w-0'>
      <dt className='text-label text-muted-foreground'>{label}</dt>
      <dd className='numeric text-xl font-semibold tracking-tight whitespace-nowrap max-sm:text-lg'>
        {children || <TextBone className='w-[4em]' />}
      </dd>
    </div>
  );
}

/** The period's merchants by what was spent with them in this category; each opens its details in Insights. */
function CategoryMerchants({
  category,
  range,
  onSelect,
}: {
  category: BankTransactionCategoryFilterValue;
  range: {from: string; to: string} | null;
  onSelect: (merchantId: string) => void;
}) {
  const {data, isPending, isPlaceholderData, error, refetch} = useGetMerchants(
    '',
    range,
    TOP,
    category,
  );
  const accepted = useFiguresCurrencyAccepted();
  const page = data?.pages[0];
  // Another period's merchants, or ones in another currency, never stand under this period.
  const waiting =
    !range ||
    isPlaceholderData ||
    (!!page && page.merchants.length > 0 && !accepted(page.baseCurrency));
  const merchants = page?.merchants.filter((merchant) => toCents(merchant.spent) > 0) ?? [];
  return (
    <Card role='region' aria-label='Top merchants' className='grid min-w-0 content-start gap-3 p-4'>
      <h2 className='text-card-title'>Top merchants</h2>
      {isPending || waiting ? (
        <div aria-busy='true'>
          <LoadingLabel>Loading merchants</LoadingLabel>
          <ul aria-hidden='true' className='-mx-4 -mb-2 divide-y divide-border/60'>
            <TileRowsSkeleton count={TOP} />
          </ul>
        </div>
      ) : !page ? (
        <LoadErrorState
          size='section'
          title="Couldn't load merchants"
          error={error}
          onRetry={refetch}
        />
      ) : merchants.length === 0 ? (
        <p className='text-body-small text-muted-foreground'>No merchants in this period.</p>
      ) : (
        <ul className='-mx-4 -mb-2 divide-y divide-border/60'>
          {merchants.map((merchant) => (
            <li key={merchant.id}>
              <MerchantRow
                merchant={merchant}
                onSelect={onSelect}
                detail={countLabel(merchant.count, 'transaction')}
                amount={formatMoney(merchant.spent, page.baseCurrency)}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The category's spending rows of the period, a page at a time, with the way to Transactions filtered to them. */
function CategoryTransactions({
  category,
  range,
}: {
  category: BankTransactionCategoryFilterValue;
  range: {from: string; to: string} | null;
}) {
  const missingBaseAmounts = useHasMissingBaseAmounts();
  return (
    <Card role='region' aria-label='Transactions' className='min-w-0'>
      {range ? (
        <TransactionPages
          drill={categoryDrill(category, range.from, range.to, missingBaseAmounts)}
          empty={`No ${categoryLabel(category).toLowerCase()} in this period.`}
        />
      ) : (
        <>
          <TransactionsHeader />
          <TransactionsSkeleton />
        </>
      )}
    </Card>
  );
}

function TransactionsSkeleton() {
  return (
    <div aria-busy='true'>
      <LoadingLabel>Loading transactions</LoadingLabel>
      <ul aria-hidden='true' className='divide-y divide-border/60 px-2 pb-2'>
        <TileRowsSkeleton count={5} />
      </ul>
    </div>
  );
}

function TransactionsHeader({drill}: {drill?: ReturnType<typeof categoryDrill>}) {
  return (
    <header className='flex min-h-11 items-center justify-between gap-3 px-4 pt-2'>
      <h2 className='text-card-title'>Transactions</h2>
      {drill && (
        <TextAction asChild className='-mr-2'>
          <Link to='/transactions' search={drill}>
            Open in Transactions
          </Link>
        </TextAction>
      )}
    </header>
  );
}

function TransactionPages({
  drill,
  empty,
}: {
  drill: ReturnType<typeof categoryDrill>;
  empty: string;
}) {
  const query = useCategoryTransactions(drill);
  const {data, isPending, error, refetch} = query;
  const transactions = data?.pages.flatMap((page) => page.transactions) ?? [];
  return (
    <>
      <TransactionsHeader drill={drill} />
      {isPending ? (
        <TransactionsSkeleton />
      ) : !data ? (
        <div className='px-4 pb-4'>
          <LoadErrorState
            size='section'
            title="Couldn't load transactions"
            error={error}
            onRetry={refetch}
          />
        </div>
      ) : transactions.length === 0 ? (
        <p className='px-4 pb-4 text-body-small text-muted-foreground'>{empty}</p>
      ) : (
        <>
          <ul className='divide-y divide-border/60 px-2 pb-2'>
            {transactions.map((transaction) => (
              <li key={transaction.id}>
                <TransactionListRow
                  transaction={transaction}
                  link={{to: '/transactions', search: {...drill, transactionId: transaction.id}}}
                />
              </li>
            ))}
          </ul>
          <LoadMore query={query} />
        </>
      )}
    </>
  );
}
