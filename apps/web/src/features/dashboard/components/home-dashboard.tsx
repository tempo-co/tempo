import {Link} from '@tanstack/react-router';
import {Landmark, RefreshCw} from 'lucide-react';

import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import {useGetAllBankConnections} from '@/features/banking/api/use-get-all-bank-connections';
import {isConnectedBank} from '@/features/banking/utils/bank-sync-status';

import {useGetBankTransactionReviewCounts} from '../api/use-get-bank-transaction-review-counts';
import {useGetBankTransactionSummary} from '../api/use-get-bank-transaction-summary';
import {localDate, shiftMonth} from '../utils/month';
import {AttentionList} from './attention-list';
import {BalanceTrendCard} from './balance-trend-card';
import {BalancesList} from './balances-list';
import {CashFlowCard} from './cash-flow-card';
import {CategoryBreakdown} from './category-breakdown';
import {HomeSyncStatus} from './home-sync-status';
import {MonthNavigation} from './month-navigation';
import {RecentTransactions} from './recent-transactions';
import {RecurringCard} from './recurring-card';

type HomeDashboardProps = {
  month: string;
  isCurrentMonth: boolean;
};

export function HomeDashboard({month, isCurrentMonth}: HomeDashboardProps) {
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

  // The cards mount while the connections load, so their requests run alongside it instead of after.
  const connections = bankConnections?.filter(isConnectedBank);
  if (connections?.length === 0) return <ConnectBankPrompt />;

  return (
    <div className='@container' aria-busy={!connections || undefined}>
      <div className='flex flex-wrap items-center justify-between gap-x-6 gap-y-4'>
        <MonthNavigation month={month} isCurrentMonth={isCurrentMonth} />
        {connections ? (
          <HomeSyncStatus connections={connections} />
        ) : (
          // Hidden on a phone like an all-clear status, so the cards below do not jump when it loads.
          <Skeleton
            className='h-4 w-64 max-md:hidden'
            role='img'
            aria-label='Loading sync status'
          />
        )}
      </div>
      <div className='mt-6 grid gap-6 @[900px]:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]'>
        <div className='grid min-w-0 content-start gap-6'>
          <CashFlowCard month={month} />
          <BalanceTrendCard connections={connections ?? []} />
          <MonthlySpending month={month} isCurrentMonth={isCurrentMonth} />
        </div>
        <div className='grid min-w-0 content-start gap-6'>
          <HomeAttention baseCurrency={connections && (connections[0]?.baseCurrency ?? null)} />
          <RecurringCard />
          {connections ? (
            <BalancesList connections={connections} isCurrentMonth={isCurrentMonth} />
          ) : (
            <Skeleton className='h-56' role='img' aria-label='Loading balances' />
          )}
          <RecentTransactions month={month} isCurrentMonth={isCurrentMonth} />
        </div>
      </div>
    </div>
  );
}

function MonthlySpending({month, isCurrentMonth}: HomeDashboardProps) {
  // A stable date after a past month ends selects whole-month history without changing its cache key each day.
  const asOf = isCurrentMonth ? localDate() : `${shiftMonth(month, 1)}-01`;
  const {summary, isPending, isError, refetch} = useGetBankTransactionSummary(month, asOf);
  if (isPending) return <Skeleton className='h-96' aria-label='Loading spending' />;
  if (isError || !summary)
    return <SectionError message='Could not load spending.' onRetry={refetch} />;
  return <CategoryBreakdown summary={summary} isCurrentMonth={isCurrentMonth} />;
}

/** `baseCurrency` is undefined until the connections load. */
function HomeAttention({baseCurrency}: {baseCurrency: string | null | undefined}) {
  const {reviewCounts, isPending, isError, refetch} = useGetBankTransactionReviewCounts();
  if (isPending || baseCurrency === undefined)
    return <Skeleton className='h-40' aria-label='Loading attention counts' />;
  if (isError || !reviewCounts)
    return <SectionError message='Could not load attention counts.' onRetry={refetch} />;
  return <AttentionList reviewCounts={reviewCounts} baseCurrency={baseCurrency} />;
}

function SectionError({message, onRetry}: {message: string; onRetry: () => unknown}) {
  return (
    <Card className='grid justify-items-start gap-4 p-5 sm:p-6'>
      <p>{message}</p>
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
      title='Connect a bank to see your month'
      description='Home summarizes spending, balances and anything that needs a look once Tempo has synced at least one account.'
    >
      <Button asChild>
        <Link to='/bank-connections'>Connect bank</Link>
      </Button>
    </EmptyState>
  );
}
