import {Link} from '@tanstack/react-router';
import type {BankTransaction} from '@wisp/contracts';
import type {ReactNode} from 'react';

import {LoadErrorState} from '@/components/shared/state-message';
import {TransactionListRow} from '@/features/banking/components/transaction-list-row';
import {LoadingLabel, TileRowsSkeleton} from '@/features/dashboard/components/loading';

import {RECENT_TRANSACTIONS} from '../api/use-home-reads';
import {type CardEditing, HomeCard} from './home-card';

/** The newest transactions; each opens in Transactions. */
export function RecentTransactionsCard({
  transactions,
  failure,
  editing,
}: {
  transactions: BankTransaction[] | undefined;
  failure?: {error: unknown; retry: () => unknown};
  editing?: CardEditing;
}) {
  const card = (children: ReactNode) => (
    <HomeCard
      name='Recent transactions'
      editing={editing}
      link={<Link to='/transactions'>All</Link>}
    >
      {children}
    </HomeCard>
  );
  if (!transactions && failure)
    return card(
      <LoadErrorState
        size='section'
        title="Couldn't load recent transactions"
        error={failure.error}
        onRetry={failure.retry}
      />,
    );
  if (!transactions)
    return card(
      <div aria-busy='true'>
        <ul className='-mx-3 grid'>
          <TileRowsSkeleton count={RECENT_TRANSACTIONS} />
        </ul>
        <LoadingLabel>Loading recent transactions</LoadingLabel>
      </div>,
    );
  if (transactions.length === 0)
    return card(<p className='text-body-small text-muted-foreground'>No transactions yet.</p>);
  return card(
    <ul className='-mx-3 grid divide-y divide-border/60'>
      {transactions.map((transaction) => (
        <li key={transaction.id}>
          <TransactionListRow
            transaction={transaction}
            link={{to: '/transactions', search: {transactionId: transaction.id}}}
          />
        </li>
      ))}
    </ul>,
  );
}
