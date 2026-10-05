import {Link} from '@tanstack/react-router';
import {RefreshCw} from 'lucide-react';

import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import {useGetAllBankConnections} from '@/features/banking/api/use-get-all-bank-connections';
import {isConnectedBank} from '@/features/banking/utils/bank-sync-status';

import {useGetBankTransactionReviewCounts} from '../api/use-get-bank-transaction-review-counts';
import {useGetBankTransactionSummary} from '../api/use-get-bank-transaction-summary';
import {localDate, monthDates} from '../utils/month';
import {AttentionList} from './attention-list';
import {BalancesList} from './balances-list';
import {CategoryBreakdown} from './category-breakdown';
import {HomeSyncStatus} from './home-sync-status';
import {MonthNavigation} from './month-navigation';
import {RecentTransactions} from './recent-transactions';
import {SpendingSummaryCard} from './spending-summary-card';

type HomeDashboardProps = {
  month: string;
  isCurrentMonth: boolean;
};

export function HomeDashboard({month, isCurrentMonth}: HomeDashboardProps) {
  const {bankConnections, isPending, isError, refetch} = useGetAllBankConnections();

  if (isPending) return <HomeDashboardSkeleton />;

  if (isError) {
    return (
      <EmptyState
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

  const connections = (bankConnections ?? []).filter(isConnectedBank);
  if (connections.length === 0) return <ConnectBankPrompt />;

  return (
    <div className='@container'>
      <div className='flex flex-wrap items-center justify-between gap-x-6 gap-y-4'>
        <MonthNavigation month={month} isCurrentMonth={isCurrentMonth} />
        <HomeSyncStatus connections={connections} />
      </div>
      <div className='mt-6 grid gap-6 @[900px]:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]'>
        <MonthlySpending month={month} isCurrentMonth={isCurrentMonth} />
        <div className='grid min-w-0 content-start gap-6'>
          <HomeAttention baseCurrency={connections[0]?.baseCurrency ?? null} />
          <BalancesList connections={connections} isCurrentMonth={isCurrentMonth} />
          <RecentTransactions month={month} isCurrentMonth={isCurrentMonth} />
        </div>
      </div>
    </div>
  );
}

function MonthlySpending({month, isCurrentMonth}: HomeDashboardProps) {
  // The API cuts a past month at its last day, so a stable date keeps that month's cache key.
  const asOf = isCurrentMonth ? localDate() : monthDates(month).to;
  const {summary, isPending, isError, refetch} = useGetBankTransactionSummary(month, asOf);
  if (isPending) return <Skeleton className='h-96' aria-label='Loading spending' />;
  if (isError || !summary)
    return <SectionError message='Could not load spending.' onRetry={refetch} />;
  return (
    <div className='grid min-w-0 content-start gap-6'>
      <SpendingSummaryCard summary={summary} isCurrentMonth={isCurrentMonth} />
      <CategoryBreakdown summary={summary} isCurrentMonth={isCurrentMonth} />
    </div>
  );
}

function HomeAttention({baseCurrency}: {baseCurrency: string | null}) {
  const {reviewCounts, isPending, isError, refetch} = useGetBankTransactionReviewCounts();
  if (isPending) return <Skeleton className='h-40' aria-label='Loading attention counts' />;
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

function HomeDashboardSkeleton() {
  return (
    <div aria-busy='true' aria-label='Loading your month' className='grid gap-5'>
      <div className='flex flex-wrap items-center justify-between gap-2.5'>
        <Skeleton className='h-8 w-44' />
        <Skeleton className='h-4 w-64' />
      </div>
      <Card className='grid gap-3 p-5 sm:p-6'>
        <Skeleton className='h-8 w-2/5' />
        <Skeleton className='h-4 w-1/2' />
        <Skeleton className='h-52' />
      </Card>
    </div>
  );
}

function ConnectBankPrompt() {
  return (
    <Card className='flex flex-col items-center gap-2.5 px-6 py-18 text-center'>
      <h2 className='text-lg font-semibold'>Connect a bank to see your month</h2>
      <p className='max-w-md text-sm text-muted-foreground'>
        Home summarizes spending, balances and anything that needs a look once Tempo has synced at
        least one account.
      </p>
      <Button asChild className='mt-2'>
        <Link to='/bank-connections'>Connect bank</Link>
      </Button>
    </Card>
  );
}
