import {Link} from '@tanstack/react-router';
import type {BankConnection, BankImportSummary} from '@tempo/contracts';
import type {ReactNode} from 'react';

import {accountFreshness} from '@/features/accounts/utils/account-freshness';
import {type Money, accountBalance, groupAccounts} from '@/features/accounts/utils/account-groups';
import {accountName} from '@/features/banking/utils/bank-account-name';
import {LoadingLabel, TextBone, TileRowsSkeleton} from '@/features/dashboard/components/loading';
import {formatCurrency} from '@/utils/format-currency';

import {type CardEditing, HomeCard} from './home-card';

/** Accounts listed before the rest are counted. */
const ROWS = 4;

const money = (value: Money) => formatCurrency(value.amount, value.currency);

/** The total across every account, then each account's balance and how current its data is; each opens its page. */
export function AccountsCard({
  connections,
  imports,
  now,
  editing,
}: {
  /** The owner's connected banks and imported files; undefined while they load. */
  connections: BankConnection[] | undefined;
  imports?: BankImportSummary[];
  now: number;
  editing?: CardEditing;
}) {
  const card = (children: ReactNode) => (
    <HomeCard name='Accounts' editing={editing} link={<Link to='/accounts'>Accounts</Link>}>
      {children}
    </HomeCard>
  );
  if (!connections)
    return card(
      <div aria-busy='true'>
        <p className='text-2xl'>
          <TextBone className='w-[5em]' />
        </p>
        <ul className='-mx-3 grid'>
          <TileRowsSkeleton count={2} />
        </ul>
        <LoadingLabel>Loading accounts</LoadingLabel>
      </div>,
    );

  const {groups, total} = groupAccounts(connections, now);
  const entries = groups.flatMap((group) => group.accounts);
  const shown = entries.slice(0, ROWS);
  return card(
    <>
      <p className='flex flex-wrap items-baseline justify-between gap-x-3'>
        <span
          data-testid='accounts-card-total'
          className='numeric text-2xl font-semibold tracking-tight'
        >
          {total ? money(total) : '—'}
        </span>
        <span className='text-body-small text-muted-foreground'>
          {entries.length} {entries.length === 1 ? 'account' : 'accounts'}
        </span>
      </p>
      <ul className='-mx-3 grid divide-y divide-border/60'>
        {shown.map(({account, connection}) => {
          const balance = accountBalance(account);
          const freshness = accountFreshness({connection, accountId: account.id, imports, now});
          return (
            <li key={account.id}>
              <Link
                to='/accounts/$accountId'
                params={{accountId: account.id}}
                className='grid min-h-15 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
              >
                <span className='min-w-0'>
                  <span className='block truncate text-body'>{accountName(account)}</span>
                  <span
                    data-tone={freshness.tone}
                    className='block truncate text-body-small text-muted-foreground data-[tone=warning]:text-warning data-[tone=ok]:max-sm:hidden'
                  >
                    {freshness.label}
                  </span>
                </span>
                <span className='numeric text-body whitespace-nowrap'>
                  {balance ? money(balance) : '—'}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {entries.length > ROWS && (
        <p className='text-body-small text-muted-foreground'>
          and {entries.length - ROWS} more on Accounts
        </p>
      )}
    </>,
  );
}
