import {Link} from '@tanstack/react-router';
import {formatDistanceToNow} from 'date-fns';

import type {BankConnection} from '@/features/banking/types/bank-connection';
import {isReauthorizationRequired} from '@/features/banking/utils/bank-sync-status';
import {cn} from '@/utils/cn';

import {formatNotSyncedSince, getHomeSyncStatus} from '../utils/sync-status';

const badgeClassName =
  'inline-flex items-center rounded-full border px-2.5 py-px text-xs font-medium';
const linkClassName =
  'text-[0.8125rem] font-medium whitespace-nowrap text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring';

function formatSyncedBanks(count: number, syncedAt: string | null) {
  if (!syncedAt) return count === 1 ? 'Your bank is syncing' : 'Your banks are syncing';
  const relative = formatDistanceToNow(new Date(syncedAt), {addSuffix: true});
  return count === 1 ? `Your bank synced ${relative}` : `All ${count} banks synced ${relative}`;
}

function formatDaysLeft(daysLeft: number) {
  if (daysLeft <= 0) return 'today';
  return daysLeft === 1 ? 'in 1 day' : `in ${daysLeft} days`;
}

/** Whether Home's numbers are current: sync failures first, then consents about to end. */
export function HomeSyncStatus({connections}: {connections: BankConnection[]}) {
  const {problems, expiringConsents, oldestSyncedAt} = getHomeSyncStatus(connections);
  const needsReconnect = problems.some(isReauthorizationRequired);

  return (
    <div
      data-testid='home-sync-status'
      className='flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.8125rem] text-muted-foreground'
    >
      {problems.length > 0 ? (
        <>
          {problems.map((connection) => (
            <span
              key={connection.id}
              className={cn(badgeClassName, 'border-destructive/60 text-foreground')}
            >
              {`${connection.aspspName} has ${formatNotSyncedSince(connection)}`}
            </span>
          ))}
          <span className='text-foreground'>Totals may be missing recent activity.</span>
          <Link to='/bank-connections' className={linkClassName}>
            {needsReconnect ? 'Reconnect' : 'View connections'}
          </Link>
        </>
      ) : (
        <span>{formatSyncedBanks(connections.length, oldestSyncedAt)}</span>
      )}
      {expiringConsents.map(({connection, daysLeft}) => (
        <Link
          key={connection.id}
          to='/bank-connections'
          className={cn(
            badgeClassName,
            'border-warning/60 text-foreground hover:bg-warning/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring',
          )}
        >
          {`${connection.aspspName} consent expires ${formatDaysLeft(daysLeft)}`}
        </Link>
      ))}
    </div>
  );
}
