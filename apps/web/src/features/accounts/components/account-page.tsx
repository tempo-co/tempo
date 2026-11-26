import {Link, useNavigate, useRouter} from '@tanstack/react-router';
import type {BankAccount, BankConnection, BankImportSummary} from '@tempo/contracts';
import {addMonths, endOfMonth, format, isSameYear, parseISO} from 'date-fns';
import {FileQuestion, FileUp, RefreshCw, Trash2, Unlink} from 'lucide-react';
import {type ReactNode, useState} from 'react';

import {LoadErrorState, StateMessage} from '@/components/shared/state-message';
import {TextAction} from '@/components/shared/text-action';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {bankLogoKey, useBankLogos} from '@/features/banking/api/use-bank-logos';
import {useTransactionPages} from '@/features/banking/api/use-transaction-pages';
import {TransactionListRow} from '@/features/banking/components/transaction-list-row';
import {accountName, formatAccountType} from '@/features/banking/utils/bank-account-name';
import {isFileConnection} from '@/features/banking/utils/bank-sync-status';
import {useGetBankBalanceTrend} from '@/features/dashboard/api/use-get-bank-balance-trend';
import {BalanceChart, BalanceChartSkeleton} from '@/features/dashboard/components/balance-chart';
import {TileRowsSkeleton} from '@/features/dashboard/components/loading';
import {periodDrill} from '@/features/dashboard/utils/drill-links';
import {useFiguresCurrencyAccepted} from '@/features/reporting-currency/api/use-reporting-currency';
import {cn} from '@/utils/cn';
import {formatCurrency} from '@/utils/format-currency';

import {useConnectBank} from '../api/use-connect-bank';
import {accountBalancePoints} from '../utils/account-balance-points';
import {accountFreshness} from '../utils/account-freshness';
import {accountBalance} from '../utils/account-groups';
import {accountSource, connectionName, headlineFigure} from '../utils/account-labels';
import {AccountTile, FreshnessLine} from './account-parts';
import {RemoveConnectionDialog} from './remove-connection-dialog';

/** Transactions the page lists before All in Transactions. */
const RECENT = 5;
/** Months of balance the chart shows, the running one included. */
const CHART_MONTHS = 12;

/**
 * One account: its balance and how it moved, its latest transactions, the imports that wrote to it, where its data
 * comes from and which dates it covers, and its connection's Reconnect and Remove.
 */
export function AccountPage({
  account,
  connection,
  imports,
  importsList,
  onImport,
  balanceAction,
  today,
  now,
}: {
  account: BankAccount;
  connection: BankConnection;
  /** The import list once it answers; undefined while file import is off or unknown. */
  imports?: BankImportSummary[];
  /** This account's imports, with Review and Undo; absent while file import is off. */
  importsList?: ReactNode;
  /** Starts an import; absent while file import is off. */
  onImport?: () => void;
  /** An imported-files account's Add balance or Edit; absent while file import is off. */
  balanceAction?: ReactNode;
  today: string;
  now: number;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const {reconnect, isStarting} = useConnectBank();
  const bankLogos = useBankLogos(true);
  const files = isFileConnection(connection);
  const name = accountName(account);
  const freshness = accountFreshness({connection, accountId: account.id, imports, now});
  const [removing, setRemoving] = useState(false);

  return (
    <div className='grid grid-cols-1 gap-5 max-md:gap-4'>
      <header className='flex min-w-0 items-start gap-3'>
        <AccountTile
          connection={connection}
          artwork={bankLogos[bankLogoKey(connection.aspspName, connection.aspspCountry)]}
          className='mt-0.5'
        />
        <div className='min-w-0'>
          <h1 className='text-page-title wrap-break-word'>{name}</h1>
          <p className='mt-1 text-body-small wrap-break-word text-muted-foreground'>
            {accountSource(account, connection)}
          </p>
          <FreshnessLine
            freshness={freshness}
            onImport={onImport}
            onReconnect={() => void reconnect(connection)}
            isStarting={isStarting}
          />
        </div>
      </header>
      <div className='grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]'>
        <div className='grid min-w-0 grid-cols-1 gap-3'>
          <BalanceCard account={account} today={today} balanceAction={balanceAction} />
          <RecentTransactions account={account} />
          {importsList && <Card className='p-4'>{importsList}</Card>}
        </div>
        <div className='grid min-w-0 grid-cols-1 gap-3'>
          <AboutCard
            account={account}
            connection={connection}
            onImport={files ? onImport : undefined}
            onRemove={files ? () => setRemoving(true) : undefined}
          />
          {!files && (
            <ConnectionCard
              connection={connection}
              canReconnect={freshness.action === 'reconnect'}
              isStarting={isStarting}
              onReconnect={() => void reconnect(connection)}
              onRemove={() => setRemoving(true)}
            />
          )}
        </div>
      </div>
      <RemoveConnectionDialog
        connection={connection}
        open={removing}
        onOpenChange={setRemoving}
        onRemoved={({kept}) => {
          setRemoving(false);
          // A kept account stays, now from statement files; a deleted one leaves nothing here. Once the owner has
          // moved on to another page, the removal's end takes them nowhere.
          const here = router.matchRoute({
            to: '/accounts/$accountId',
            params: {accountId: account.id},
          });
          if (!kept && here) void navigate({to: '/accounts', replace: true});
        }}
      />
    </div>
  );
}

/** The account isn't among the owner's: removed, undone or never theirs. */
export function AccountNotFound() {
  return (
    <StateMessage
      icon={FileQuestion}
      titleAs='h1'
      title='Account not found'
      description='It may have been removed, or its import undone.'
    >
      <Button variant='outline' asChild>
        <Link to='/accounts'>All accounts</Link>
      </Button>
    </StateMessage>
  );
}

function BalanceCard({
  account,
  today,
  balanceAction,
}: {
  account: BankAccount;
  today: string;
  balanceAction?: ReactNode;
}) {
  const navigate = useNavigate();
  const balance = accountBalance(account);
  const from = format(addMonths(parseISO(today), 1 - CHART_MONTHS), 'yyyy-MM-01');
  const trend = useGetBankBalanceTrend('month', from, today, today);
  const accepted = useFiguresCurrencyAccepted();
  const points =
    trend.balanceTrend && accepted(trend.balanceTrend.baseCurrency)
      ? accountBalancePoints(trend.balanceTrend, account.id)
      : null;
  const known = points?.filter((point) => point.balance !== null).length ?? 0;
  const reported = account.balanceUpdatedAt;

  return (
    <Card className='p-4' data-testid='account-balance'>
      <h2 className='text-card-title'>Balance</h2>
      <div className='mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1'>
        {balance ? (
          <span className={headlineFigure(formatCurrency(balance.amount, balance.currency))}>
            {formatCurrency(balance.amount, balance.currency)}
          </span>
        ) : (
          <span className='text-body text-muted-foreground'>No balance yet</span>
        )}
        {balance && reported && (
          <span className='text-body-small text-muted-foreground'>
            on {shortDate(reported, today)}
          </span>
        )}
        {balanceAction}
      </div>
      {/* A line needs two points; the running month is one of them. */}
      {points === null ? (
        trend.isError ? null : (
          <BalanceChartSkeleton />
        )
      ) : (
        known > 1 && (
          <div className='mt-3 flex'>
            <BalanceChart
              points={points}
              unit='month'
              currency={trend.balanceTrend!.baseCurrency}
              onPick={(month) => {
                const start = `${month}-01`;
                const end = format(endOfMonth(parseISO(start)), 'yyyy-MM-dd');
                void navigate({
                  to: '/transactions',
                  search: {
                    ...periodDrill(start, end < today ? end : today),
                    bankAccountIds: [account.id],
                  },
                });
              }}
            />
          </div>
        )
      )}
    </Card>
  );
}

function RecentTransactions({account}: {account: BankAccount}) {
  const query = useTransactionPages(
    [...dashboardQueryKeys.root, 'account-transactions', account.id],
    {'filter[bankAccountIds][]': account.id},
    {pageSize: RECENT},
  );
  const transactions = query.data?.pages[0]?.transactions;

  return (
    <Card
      role='region'
      aria-labelledby='account-transactions-heading'
      className='grid grid-cols-1 gap-2 p-4 pb-2'
    >
      <header className='flex items-center justify-between gap-3'>
        <h2 id='account-transactions-heading' className='text-card-title'>
          Transactions
        </h2>
        <TextAction asChild className='-my-1 -mr-2'>
          <Link to='/transactions' search={{bankAccountIds: [account.id]}}>
            All in Transactions
          </Link>
        </TextAction>
      </header>
      {query.isPending ? (
        <ul aria-label='Loading transactions' className='-mx-3 grid grid-cols-1'>
          <TileRowsSkeleton count={3} />
        </ul>
      ) : !transactions ? (
        <LoadErrorState
          size='section'
          className='pb-2'
          title="Couldn't load transactions"
          error={query.error}
          onRetry={() => query.refetch()}
        />
      ) : transactions.length === 0 ? (
        <p className='pb-2 text-body-small text-muted-foreground'>No transactions yet</p>
      ) : (
        <ul className='-mx-3 divide-y divide-border/60'>
          {transactions.map((transaction) => (
            <li key={transaction.id}>
              <TransactionListRow
                transaction={transaction}
                link={{
                  to: '/transactions',
                  search: {bankAccountIds: [account.id], transactionId: transaction.id},
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AboutCard({
  account,
  connection,
  onImport,
  onRemove,
}: {
  account: BankAccount;
  connection: BankConnection;
  onImport?: () => void;
  onRemove?: () => void;
}) {
  const files = isFileConnection(connection);
  const covered = useCoveredDates(account.id);
  const facts = [
    {label: 'Type', value: formatAccountType(account.cashAccountType) ?? 'Account'},
    !files && {label: 'Bank', value: connection.aspspName},
    account.maskedIdentifier && {label: 'Number', value: account.maskedIdentifier},
    {label: 'Currency', value: account.currency},
    {label: 'Data from', value: files ? 'Statement files' : 'Live sync'},
    {label: 'Covers', value: covered ?? '—'},
  ].filter((fact) => !!fact);

  return (
    <Card className='grid grid-cols-1 gap-4 p-4' data-testid='account-about'>
      <h2 className='text-card-title'>About this account</h2>
      <Facts facts={facts} />
      {(onImport || onRemove) && (
        <div className='grid grid-cols-1 gap-2'>
          {onImport && (
            <Button variant='outline' onClick={onImport}>
              <FileUp aria-hidden='true' />
              Import a newer file
            </Button>
          )}
          {onRemove && (
            <Button
              variant='ghost'
              onClick={onRemove}
              className='text-destructive hover:text-destructive'
            >
              <Trash2 aria-hidden='true' />
              Remove imported files
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function ConnectionCard({
  connection,
  canReconnect,
  isStarting,
  onReconnect,
  onRemove,
}: {
  connection: BankConnection;
  canReconnect: boolean;
  isStarting: boolean;
  onReconnect: () => void;
  onRemove: () => void;
}) {
  const consent = connection.consentValidUntil;
  const facts = [
    {label: 'Country', value: formatCountry(connection.aspspCountry)},
    {label: 'Accounts', value: String(connection.bankAccounts.length)},
    {
      label: 'Access until',
      value: consent ? format(new Date(consent), 'd MMM yyyy') : '—',
      warn: canReconnect,
    },
    {
      label: 'Updated',
      value: connection.lastSyncedAt
        ? format(new Date(connection.lastSyncedAt), 'd MMM, HH:mm')
        : 'Never',
    },
  ];

  return (
    <Card
      role='region'
      aria-labelledby='account-connection-heading'
      className='grid grid-cols-1 gap-4 p-4'
      data-testid='account-connection'
    >
      <h2 id='account-connection-heading' className='text-card-title'>
        {connectionName(connection)} connection
      </h2>
      <Facts facts={facts} />
      <div className='grid grid-cols-1 gap-2'>
        {canReconnect && (
          <Button disabled={isStarting} onClick={onReconnect}>
            <RefreshCw aria-hidden='true' />
            {isStarting ? 'Starting…' : 'Reconnect'}
          </Button>
        )}
        <Button
          variant='ghost'
          onClick={onRemove}
          className='text-destructive hover:text-destructive'
        >
          <Unlink aria-hidden='true' />
          Remove connection
        </Button>
      </div>
    </Card>
  );
}

function Facts({facts}: {facts: {label: string; value: string; warn?: boolean}[]}) {
  return (
    <dl className='grid grid-cols-2 gap-x-4 gap-y-3'>
      {facts.map((fact) => (
        <div key={fact.label} className='min-w-0'>
          <dt className='text-label text-muted-foreground'>{fact.label}</dt>
          <dd className={cn('text-body wrap-break-word', fact.warn && 'text-warning')}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The first and last booking day the account holds: `1 Dec 2025 – 20 Nov 2026`. */
function useCoveredDates(accountId: string) {
  const filters = {'filter[bankAccountIds][]': accountId};
  const key = [...dashboardQueryKeys.root, 'account-transactions', accountId];
  const newest = useTransactionPages(key, filters, {pageSize: RECENT});
  const oldest = useTransactionPages(
    [...key, 'oldest'],
    {...filters, 'sort[by]': 'date', 'sort[order]': 'ASC'},
    {pageSize: RECENT},
  );
  const last = newest.data?.pages[0]?.transactions[0]?.date;
  const first = oldest.data?.pages[0]?.transactions[0]?.date;
  if (!first || !last) return null;
  const from = parseISO(first);
  const to = parseISO(last);
  return `${format(from, isSameYear(from, to) ? 'd MMM' : 'd MMM yyyy')} – ${format(to, 'd MMM yyyy')}`;
}

const regionNames = new Intl.DisplayNames(undefined, {type: 'region'});

function formatCountry(code: string) {
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

function shortDate(value: string, today: string) {
  const date = new Date(value);
  return format(date, isSameYear(date, parseISO(today)) ? 'd MMM' : 'd MMM yyyy');
}
