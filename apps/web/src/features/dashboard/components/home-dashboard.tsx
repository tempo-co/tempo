import {Link} from '@tanstack/react-router';
import {History, Landmark, RefreshCw} from 'lucide-react';

import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import {useGetAllBankConnections} from '@/features/banking/api/use-get-all-bank-connections';
import {isConnectedBank} from '@/features/banking/utils/bank-sync-status';

import {useOverview} from '../api/use-overview';
import {yearColumnWidth} from '../utils/overview';
import {HeatTable} from './heat-table';
import {WhereYouStand} from './where-you-stand';
import {YearTable} from './year-table';

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

function HomeHistory({today, onOpenMonth}: HomeDashboardProps) {
  const {overview, isError, refetch} = useOverview(today);
  if (isError)
    return (
      <Card className='grid justify-items-start gap-4 p-5 sm:p-6'>
        <p>Could not load your history.</p>
        <Button variant='outline' onClick={() => void refetch()}>
          Try again
        </Button>
      </Card>
    );
  if (!overview)
    return <Skeleton className='h-[36rem]' role='img' aria-label='Loading your history' />;
  if (overview.months.length === 0)
    return (
      <EmptyState
        icon={History}
        title='No history yet'
        description='Balances and spending appear here once the first transactions have synced.'
      />
    );
  const columnWidth = yearColumnWidth(
    [...overview.categories, ...overview.sources],
    overview.months,
    overview.currency,
  );
  return (
    <div className='grid gap-6'>
      <WhereYouStand overview={overview} onOpenMonth={onOpenMonth} />
      <YearTable overview={overview} />
      <HeatTable
        title='Spending by category'
        periods={overview.categories}
        months={overview.months}
        currency={overview.currency}
        kind='category'
        columnWidth={columnWidth}
      />
      <HeatTable
        title='Income by source'
        periods={overview.sources}
        months={overview.months}
        currency={overview.currency}
        kind='source'
        columnWidth={columnWidth}
      />
    </div>
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
