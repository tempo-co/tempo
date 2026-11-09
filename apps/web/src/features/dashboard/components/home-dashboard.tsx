import {Link} from '@tanstack/react-router';
import {History, Landmark, RefreshCw} from 'lucide-react';

import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {useGetAllBankConnections} from '@/features/banking/api/use-get-all-bank-connections';
import {isConnectedBank} from '@/features/banking/utils/bank-sync-status';

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
  const {bankConnections, isError, refetch} = useGetAllBankConnections();

  if (isError) {
    return (
      <EmptyState
        tone='error'
        icon={RefreshCw}
        title='Could not load your banks'
        description='The connection service did not respond. Try again in a moment.'
      >
        <Button variant='outline' onClick={() => void refetch()}>
          Try again
        </Button>
      </EmptyState>
    );
  }

  // The history requests run while the connections load, instead of after.
  const connections = bankConnections?.filter(isConnectedBank);
  if (connections?.length === 0) return <ConnectBankPrompt />;

  return (
    <div className='@container' aria-busy={!connections || undefined}>
      <HomeHistory today={today} onOpenMonth={onOpenMonth} />
    </div>
  );
}

/** Each section shows as soon as its own data arrives, in a placeholder of its loaded size until then. */
function HomeHistory({today, onOpenMonth}: HomeDashboardProps) {
  const {overview, isError, refetch} = useOverview(today);
  if (isError) return <LoadError what='your history' onRetry={refetch} />;
  if (overview?.months.length === 0)
    return (
      <EmptyState
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
  const {breakdowns, isError, refetch} = useYearBreakdowns(today);
  if (isError) return <LoadError what='spending and income by year' onRetry={refetch} />;
  if (!overview || !breakdowns)
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

function LoadError({what, onRetry}: {what: string; onRetry: () => unknown}) {
  return (
    <Card className='grid justify-items-start gap-4 p-5 sm:p-6'>
      <p>Could not load {what}.</p>
      <Button variant='outline' onClick={() => void onRetry()}>
        Try again
      </Button>
    </Card>
  );
}

function ConnectBankPrompt() {
  return (
    <EmptyState
      icon={Landmark}
      title='Connect a bank to see where you stand'
      description='Home shows your balance over the years, what you kept and where your money went once at least one account has synced.'
    >
      <Button asChild>
        <Link to='/bank-connections'>Connect bank</Link>
      </Button>
    </EmptyState>
  );
}
