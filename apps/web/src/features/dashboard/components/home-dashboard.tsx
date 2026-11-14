import {Link} from '@tanstack/react-router';
import {History, Landmark} from 'lucide-react';

import {LoadErrorState, StateMessage} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {useGetAllBankConnections} from '@/features/banking/api/use-get-all-bank-connections';
import {isConnectedBank, isSyncInProgress} from '@/features/banking/utils/bank-sync-status';
import {useReportingCurrency} from '@/features/reporting-currency/api/use-reporting-currency';
import {
  RecalculatingTotals,
  ReportingCurrencySetup,
} from '@/features/reporting-currency/components/reporting-currency-setup';

import {useOverview, useYearBreakdowns} from '../api/use-overview';
import {type Overview, yearColumnWidth} from '../utils/overview';
import {HeatTable, HeatTableSkeleton} from './heat-table';
import {WhereYouStand} from './where-you-stand';
import {YearTable, YearTableSkeleton} from './year-table';

type HomeDashboardProps = {
  /** The local date everything is judged at. */
  today: string;
  onOpenMonth: (month: string) => void;
};

/** Where the owner stands over the years: the balance and what was kept, year by year, and where money went. */
export function HomeDashboard({today, onOpenMonth}: HomeDashboardProps) {
  const {bankConnections, isError, error, refetch} = useGetAllBankConnections();
  const {data: reporting} = useReportingCurrency();

  if (isError) {
    return <LoadErrorState title="Couldn't load your banks" error={error} onRetry={refetch} />;
  }

  // The history requests run while the connections load, instead of after.
  const connections = bankConnections?.filter(isConnectedBank);
  if (connections?.length === 0) return <ConnectBankPrompt />;
  // Without a currency to add them up in, there are no combined figures to show, only the question.
  if (reporting?.setupRequired && reporting.currency === null) return <ReportingCurrencySetup />;
  if (reporting?.recalculating) return <RecalculatingTotals currency={reporting.currency} />;

  return (
    <div className='@container grid gap-6' aria-busy={!connections || undefined}>
      <ReportingCurrencySetup />
      <HomeHistory
        today={today}
        onOpenMonth={onOpenMonth}
        importing={connections?.filter(isSyncInProgress).map((bank) => bank.aspspName) ?? []}
      />
    </div>
  );
}

/** Each section shows as soon as its own data arrives, in a placeholder of its loaded size until then. */
function HomeHistory({
  today,
  onOpenMonth,
  importing,
}: HomeDashboardProps & {
  /** Banks whose sync is running; with no history yet, that is the first import. */
  importing: string[];
}) {
  const {overview, isError, error, refetch} = useOverview(today);
  if (isError)
    return <LoadErrorState title="Couldn't load your history" error={error} onRetry={refetch} />;
  // The connections poll while a sync runs, and Home reloads when it finishes.
  if (overview?.months.length === 0 && importing.length > 0)
    return (
      <StateMessage
        icon={History}
        title='Importing your history'
        description={`${importing.length === 1 ? importing[0] : 'Your banks'} ${importing.length === 1 ? 'is' : 'are'} sending your transactions. They appear here when the import finishes.`}
      />
    );
  if (overview?.months.length === 0)
    return (
      <StateMessage
        icon={History}
        title='No history yet'
        description='Balances and spending appear here once the first transactions have synced.'
      />
    );
  return (
    <div className='grid gap-6'>
      <WhereYouStand overview={overview} today={today} onOpenMonth={onOpenMonth} />
      {overview ? <YearTable overview={overview} /> : <YearTableSkeleton />}
      <YearBreakdowns today={today} overview={overview} />
    </div>
  );
}

/** Spending by category and income by source, year by year; their year columns line up. */
function YearBreakdowns({today, overview}: {today: string; overview: Overview | null}) {
  const {breakdowns, isError, error, refetch} = useYearBreakdowns(today);
  if (isError)
    return (
      <LoadErrorState
        title="Couldn't load spending and income by year"
        error={error}
        onRetry={refetch}
      />
    );
  // Breakdowns read on the other side of a currency change than the history wait for their refetch.
  if (!overview || !breakdowns || breakdowns.currency !== overview.currency)
    return (
      <>
        <HeatTableSkeleton title='Spending by category' kind='category' />
        <HeatTableSkeleton title='Income by source' kind='source' />
      </>
    );
  const columnWidth = yearColumnWidth(
    [...breakdowns.categories, ...breakdowns.sources],
    overview.months,
    overview.currency,
  );
  return (
    <>
      <HeatTable
        title='Spending by category'
        periods={breakdowns.categories}
        months={overview.months}
        currency={overview.currency}
        kind='category'
        columnWidth={columnWidth}
      />
      <HeatTable
        title='Income by source'
        periods={breakdowns.sources}
        months={overview.months}
        currency={overview.currency}
        kind='source'
        columnWidth={columnWidth}
      />
    </>
  );
}

function ConnectBankPrompt() {
  return (
    <StateMessage
      icon={Landmark}
      title='Connect a bank to see where you stand'
      description='Your balance over the years, what you kept and where the money went, once one account has synced.'
    >
      <Button asChild>
        <Link to='/bank-connections'>Connect a bank</Link>
      </Button>
    </StateMessage>
  );
}
