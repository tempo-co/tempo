import {Check, Eye, LayoutGrid} from 'lucide-react';
import {type ReactNode, useState} from 'react';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {LoadErrorState} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {useAddData} from '@/features/add-data/use-add-data';
import {useGetAllBankConnections} from '@/features/banking/api/use-get-all-bank-connections';
import {useGetBankTransactionReviewCounts} from '@/features/banking/api/use-get-bank-transaction-review-counts';
import {useGetRecurringSummary} from '@/features/banking/api/use-get-recurring-summary';
import {isConnectedBank} from '@/features/banking/utils/bank-sync-status';
import {useGetBankTransactionBreakdown} from '@/features/dashboard/api/use-get-bank-transaction-breakdown';
import {useBankImports} from '@/features/file-import/api/use-bank-imports';
import {useInstallCard} from '@/features/install/use-install';
import {
  reportingCurrencyKnown,
  useFiguresCurrencyAccepted,
  useReportingCurrency,
} from '@/features/reporting-currency/api/use-reporting-currency';
import {
  RecalculatingTotals,
  ReportingCurrencySetup,
} from '@/features/reporting-currency/components/reporting-currency-setup';
import {useCurrentAccount} from '@/hooks/use-current-account';
import {useIsMobile} from '@/hooks/use-is-mobile';
import {useIsWide} from '@/hooks/use-is-wide';
import {useLocalDate} from '@/hooks/use-local-date';
import {useNow} from '@/hooks/use-now';

import {useDataCoverage, useRecentTransactions, useSpendingPace} from '../api/use-home-reads';
import {useHomeLayout} from '../use-home-layout';
import {awaitingFirstFetch, withData} from '../utils/first-fetch';
import {greeting} from '../utils/greeting';
import {
  HOME_CARDS,
  type HomeCardId,
  type HomeLayout,
  moveCard,
  phoneRuns,
  setCardHidden,
  visibleCards,
} from '../utils/home-layout';
import {toDoRows} from '../utils/to-do-rows';
import {AccountsCard} from './accounts-card';
import {ComingUpCard} from './coming-up-card';
import {DataOnItsWay, EmptyHome} from './first-run-home';
import type {CardEditing} from './home-card';
import {PaceCard} from './pace-card';
import {RecentTransactionsCard} from './recent-transactions-card';
import {ToDoCard} from './to-do-card';
import {TopCategoriesCard} from './top-categories-card';
import {YourDataCard} from './your-data-card';

/**
 * Home: how this month's spending compares with the usual pace, how far the data runs, and what needs the owner. A
 * main column of figures beside a sticky rail; on narrower screens one column with Your data and To do first. The
 * owner hides and reorders the cards, kept on this device.
 */
export function HomePage() {
  const reporting = useReportingCurrency();
  const {bankConnections, isError, error, refetch} = useGetAllBankConnections();
  const [editing, setEditing] = useState(false);

  let body: ReactNode;
  // Cards to customize only once Home shows them.
  let cards = false;
  const connections = bankConnections?.filter(isConnectedBank);
  if (!reportingCurrencyKnown(reporting)) body = null;
  else if (isError && !bankConnections)
    body = <LoadErrorState title="Couldn't load your banks" error={error} onRetry={refetch} />;
  else if (connections && withData(connections).length === 0) body = <EmptyHome />;
  else if (connections && awaitingFirstFetch(connections))
    body = <DataOnItsWay connections={connections} />;
  else if (reporting.data?.setupRequired && reporting.data.currency === null)
    body = <ReportingCurrencySetup />;
  else if (reporting.data?.recalculating)
    body = <RecalculatingTotals currency={reporting.data.currency} />;
  else {
    body = <HomeCards connections={connections} editing={editing} />;
    cards = true;
  }
  const title = <HomeTitle editing={cards ? editing : undefined} onEdit={setEditing} />;

  return (
    <AppBodyLayout>
      <div className='grid grid-cols-1 gap-4'>
        {title}
        {body}
      </div>
    </AppBodyLayout>
  );
}

/**
 * "Good afternoon, Alex" when a name is set, otherwise the page's name beside Customize while Home shows its cards
 * (`editing` set). Before then a nameless Home shows no title line, only the page's name for assistive technology.
 */
function HomeTitle({
  editing,
  onEdit,
}: {
  editing: boolean | undefined;
  onEdit: (editing: boolean) => void;
}) {
  const name = useCurrentAccount({skipFetch: true}).currentAccount?.name.trim().split(/\s+/)[0];
  if (!name && editing === undefined) return <h1 className='sr-only'>Home</h1>;
  return (
    <header className='flex min-h-8 items-start justify-between gap-3'>
      <h1 className='min-w-0 truncate text-page-title'>
        {name ? `${greeting(new Date())}, ${name}` : 'Home'}
      </h1>
      {editing !== undefined && (
        <Button
          variant={editing ? 'default' : 'ghost'}
          className='-my-1 shrink-0'
          aria-pressed={editing}
          onClick={() => onEdit(!editing)}
        >
          {editing ? <Check aria-hidden='true' /> : <LayoutGrid aria-hidden='true' />}
          {editing ? 'Done' : 'Customize'}
        </Button>
      )}
    </header>
  );
}

function HomeCards({
  connections,
  editing,
}: {
  /** Undefined while the banks load; each card shows its own placeholder meanwhile. */
  connections: ReturnType<typeof useGetAllBankConnections>['bankConnections'];
  editing: boolean;
}) {
  const today = useLocalDate();
  const month = today.slice(0, 7);
  const now = useNow();
  const wide = useIsWide();
  const [layout, setLayout] = useHomeLayout();
  const accepted = useFiguresCurrencyAccepted();
  const addData = useAddData();
  const imports = useBankImports();

  const pace = useSpendingPace(today);
  const coverage = useDataCoverage(today);
  const recent = useRecentTransactions();
  const categories = useGetBankTransactionBreakdown(
    'month',
    'category',
    `${month}-01`,
    today,
    today,
  );
  const recurring = useGetRecurringSummary(today);
  const review = useGetBankTransactionReviewCounts();
  const {reviewCounts} = review;
  const install = useInstallCard(useIsMobile());

  // Figures read on the other side of a currency change wait for their refetch.
  const paceShown = pace.pace && accepted(pace.pace.baseCurrency) ? pace.pace : undefined;
  const breakdown =
    categories.breakdown && accepted(categories.breakdown.baseCurrency)
      ? categories.breakdown
      : undefined;
  const summary =
    recurring.summary && accepted(recurring.summary.baseCurrency) ? recurring.summary : undefined;
  const failure = (query: {isError: boolean; error: unknown; refetch: () => unknown}) =>
    query.isError ? {error: query.error, retry: () => query.refetch()} : undefined;
  // Without the newest transactions to say whether any exist, a bank or file is connected, so data is taken as in.
  const hasData = recent.isError ? true : recent.total === undefined ? undefined : recent.total > 0;
  const rows =
    reviewCounts && hasData !== undefined
      ? toDoRows({hasData, toCheck: reviewCounts.needsAttention, install})
      : undefined;

  const runs = wide ? Object.values(visibleCards(layout)) : phoneRuns(layout);
  const editingOf = (card: HomeCardId): CardEditing | undefined => {
    if (!editing) return undefined;
    const run = runs.find((cards) => cards.includes(card)) ?? [];
    const index = run.indexOf(card);
    return {
      onUp: index > 0 ? () => setLayout(moveCard(layout, run, card, -1)) : undefined,
      onDown: index < run.length - 1 ? () => setLayout(moveCard(layout, run, card, 1)) : undefined,
      onHide: () => setLayout(setCardHidden(layout, card, true)),
    };
  };

  const render = (card: HomeCardId) => {
    const edit = editingOf(card);
    switch (card) {
      case 'pace':
        return (
          <PaceCard
            key={card}
            month={month}
            pace={paceShown}
            failure={failure(pace)}
            editing={edit}
          />
        );
      case 'categories':
        return (
          <TopCategoriesCard
            key={card}
            period={
              breakdown ? (breakdown.periods[breakdown.periods.length - 1] ?? null) : undefined
            }
            currency={breakdown?.baseCurrency ?? null}
            failure={failure(categories)}
            editing={edit}
          />
        );
      case 'accounts':
        return (
          <AccountsCard
            key={card}
            connections={connections}
            imports={imports.data}
            now={now}
            editing={edit}
          />
        );
      case 'recent':
        return (
          <RecentTransactionsCard
            key={card}
            transactions={recent.transactions}
            failure={failure(recent)}
            editing={edit}
          />
        );
      case 'data':
        return (
          <YourDataCard
            key={card}
            coverage={coverage.coverage}
            connections={connections ?? []}
            failure={failure(coverage)}
            onImport={imports.state === 'on' ? addData.openImport : undefined}
            editing={edit}
          />
        );
      case 'todo':
        return <ToDoCard key={card} rows={rows} failure={failure(review)} editing={edit} />;
      case 'coming':
        return (
          <ComingUpCard
            key={card}
            today={today}
            summary={summary}
            failure={failure(recurring)}
            editing={edit}
          />
        );
    }
  };

  const {main, rail} = visibleCards(layout);
  return (
    <>
      {/* Asks which currency to add up in while a figure in another one needs an answer; nothing otherwise. */}
      <ReportingCurrencySetup />
      {editing && (
        <CustomizeTray
          layout={layout}
          onShow={(card) => setLayout(setCardHidden(layout, card, false))}
        />
      )}
      {wide ? (
        <div className='grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-3'>
          <div className='@container grid min-w-0 gap-3'>
            <MainColumn cards={main} render={render} />
          </div>
          <aside aria-label='Your data and what needs you' className='sticky top-6 grid gap-3'>
            {rail.map(render)}
          </aside>
        </div>
      ) : (
        <div className='grid gap-3'>{runs.flat().map(render)}</div>
      )}
    </>
  );
}

/**
 * The main column's cards in order: the pace and recent transactions take the full width, and two half-width cards
 * in a row (Top categories and Accounts by default) sit side by side once the column has the room.
 */
function MainColumn({
  cards,
  render,
}: {
  cards: HomeCardId[];
  render: (card: HomeCardId) => ReactNode;
}) {
  return (
    <div className='grid gap-3 @[40rem]:grid-cols-2'>
      {cards.map((card) => (
        <div
          key={card}
          className={HALF.has(card) ? 'grid min-w-0' : 'grid min-w-0 @[40rem]:col-span-2'}
        >
          {render(card)}
        </div>
      ))}
    </div>
  );
}

const HALF = new Set<HomeCardId>(['categories', 'accounts']);

/** While customizing: how to move cards, the hidden ones to show again, and where the layout is kept. */
function CustomizeTray({layout, onShow}: {layout: HomeLayout; onShow: (card: HomeCardId) => void}) {
  return (
    <section
      aria-label='Customize Home'
      className='flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed px-4 py-3 text-body-small text-muted-foreground'
    >
      <span>Move cards with the arrows. Hidden:</span>
      {layout.hidden.length === 0 ? (
        <span>nothing</span>
      ) : (
        layout.hidden.map((card) => (
          <Button key={card} variant='outline' size='sm' onClick={() => onShow(card)}>
            <Eye aria-hidden='true' />
            Show {HOME_CARDS[card].name}
          </Button>
        ))
      )}
      <span className='ml-auto'>Saved on this device</span>
    </section>
  );
}
