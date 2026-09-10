import {AlertTriangle, Building2, Loader, Plus, RefreshCw} from 'lucide-react';
import {toast} from 'sonner';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import {HttpError} from '@/utils/api';
import {cn} from '@/utils/cn';
import {formatRetryAfter} from '@/utils/retry-after';

import {useGetBankConnectionTransactions} from '../api/use-get-bank-connection-transactions';
import {useStartBankConnection} from '../api/use-start-bank-connection';
import {useSyncBankConnection} from '../api/use-sync-bank-connection';
import {BankConnection, BankTransaction} from '../types/bank-connection';
import {
  formatBankTransactionCompactDate,
  formatBankTransactionStatus,
  formatBankingWords,
  resolveBankTransactionDisplayTitle,
} from '../utils/formatters';

type BankConnectionListProps = {
  bankConnections: BankConnection[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onTransactionSelect: (transactionId: BankTransaction['id'], trigger: HTMLButtonElement) => void;
};

const ABN_AMRO = {
  request: {aspspName: 'ABN AMRO', aspspCountry: 'NL'},
  displayName: 'ABN AMRO',
  testId: 'connect-abn-amro-button',
};

const MOCK_ASPSP = {
  request: {aspspName: 'Mock ASPSP', aspspCountry: 'NL'},
  displayName: 'Mock ASPSP',
  testId: 'connect-mock-aspsp-button',
};

const targetBank = import.meta.env.MODE === 'development' ? MOCK_ASPSP : ABN_AMRO;

type ConnectBankButtonProps = {
  onClick: () => void;
  isPending: boolean;
  className?: string;
  testId?: string;
  showIcon?: boolean;
};

function ConnectBankButton({
  onClick,
  isPending,
  className,
  testId,
  showIcon = false,
}: ConnectBankButtonProps) {
  return (
    <Button
      className={cn(
        'max-md:h-auto max-md:min-h-11 max-md:max-w-full max-md:whitespace-normal',
        className,
      )}
      onClick={onClick}
      disabled={isPending}
      data-testid={testId}
    >
      {showIcon && (isPending ? <Loader className='animate-slow-spin' /> : <Plus />)}
      {isPending ? 'Connecting...' : `Connect ${targetBank.displayName}`}
    </Button>
  );
}

function ConnectionPageFrame({
  children,
  connectBank,
  isStarting,
  showConnect = true,
}: {
  children: React.ReactNode;
  connectBank: () => void;
  isStarting: boolean;
  showConnect?: boolean;
}) {
  return (
    <div className='flex flex-col gap-6 max-md:gap-4' data-testid='bank-connections-list'>
      <div
        data-testid='bank-connections-heading'
        className='flex items-end justify-between gap-4 max-md:flex-col max-md:items-stretch max-md:gap-3'
      >
        <div className='min-w-0'>
          <h1 className='text-2xl font-semibold'>Bank connections</h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            Read-only connections to your financial institutions.
          </p>
        </div>
        {showConnect && (
          <ConnectBankButton
            onClick={connectBank}
            isPending={isStarting}
            testId={targetBank.testId}
            showIcon
            className='max-md:self-start'
          />
        )}
      </div>
      {children}
    </div>
  );
}

export function BankConnectionList({
  bankConnections,
  isPending,
  isError,
  onRetry,
  onTransactionSelect,
}: BankConnectionListProps) {
  const {startBankConnection, isPending: isStarting} = useStartBankConnection();

  const connectBank = async () => {
    try {
      const {authorizationUrl} = await startBankConnection(targetBank.request);
      window.location.assign(authorizationUrl);
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) return;
      toast.error('Unable to add bank connection', {
        description: 'Please try again in a moment.',
        id: 'bank-connection-start-failed',
      });
    }
  };

  return (
    <ConnectionPageFrame
      connectBank={connectBank}
      isStarting={isStarting}
      showConnect={!isPending && !isError}
    >
      {isPending ? (
        <Skeleton
          className='h-[22rem] w-full rounded-lg bg-card'
          role='status'
          aria-label='Loading bank connections'
          data-testid='bank-connections-loading'
        />
      ) : isError ? (
        <div role='alert'>
          <EmptyState
            icon={RefreshCw}
            title='Could not load bank connections'
            description='The connection service did not respond. Try again in a moment.'
          >
            <Button
              variant='outline'
              onClick={onRetry}
              data-testid='bank-connections-retry'
              className='min-h-11'
            >
              Try again
            </Button>
          </EmptyState>
        </div>
      ) : bankConnections.length === 0 ? (
        <Card>
          <CardContent className='flex flex-col items-center py-16 text-center'>
            <Building2 className='mb-5 h-12 w-12 text-muted-foreground' />
            <h2 className='text-xl font-semibold'>No bank connections</h2>
            <p className='mt-2 max-w-md text-sm text-muted-foreground'>
              Connect {targetBank.displayName} to make its available bank accounts part of your
              financial history.
            </p>
          </CardContent>
        </Card>
      ) : (
        bankConnections.map((connection) => (
          <BankConnectionCard
            key={connection.id}
            connection={connection}
            onTransactionSelect={onTransactionSelect}
          />
        ))
      )}
    </ConnectionPageFrame>
  );
}

function BankConnectionCard({
  connection,
  onTransactionSelect,
}: {
  connection: BankConnection;
  onTransactionSelect: BankConnectionListProps['onTransactionSelect'];
}) {
  const isAuthorized = connection.status === 'AUTHORIZED';
  const connectionHeadingId = `bank-connection-${connection.id}-heading`;
  const accountsHeadingId = `bank-connection-${connection.id}-accounts`;
  const transactionsHeadingId = `bank-connection-${connection.id}-transactions`;
  const {syncBankConnection, isPending: isSyncing} = useSyncBankConnection();
  const {
    transactions,
    total,
    isPending: areTransactionsPending,
    isError: areTransactionsError,
    refetch: refetchTransactions,
  } = useGetBankConnectionTransactions(connection.id, isAuthorized && !!connection.lastSyncedAt);

  const syncBank = async () => {
    try {
      const run = await syncBankConnection(connection.id);
      if (run.rateLimitSource === 'enable-banking') {
        toast.warning('Bank connection sync rate-limited', {
          description: `The bank connection is temporarily limiting background access. ${formatRetryAfter(run.retryAfterSeconds)}`,
          id: `bank-sync-rate-limit-${connection.id}`,
        });
      } else if (run.status === 'SUCCEEDED') {
        const description =
          run.transactionsAdded === undefined
            ? 'Synchronization completed.'
            : run.transactionsAdded === 0
              ? 'No new transactions found.'
              : `${run.transactionsAdded} new ${run.transactionsAdded === 1 ? 'transaction' : 'transactions'} added.`;

        toast.success('Sync complete', {
          description,
          id: `bank-sync-success-${connection.id}`,
        });
      } else if (run.status === 'PARTIAL') {
        toast.warning('Bank connection partially synchronized', {
          description: 'Some bank connection data could not be synchronized.',
          id: `bank-sync-partial-${connection.id}`,
        });
      } else {
        toast.error('Bank connection synchronization failed', {
          description: 'Please try again later.',
          id: `bank-sync-failed-${connection.id}`,
        });
      }
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) return;
      toast.error('Unable to synchronize bank connection', {
        description: 'Please try again in a moment.',
        id: `bank-sync-request-failed-${connection.id}`,
      });
    }
  };

  return (
    <Card
      className='overflow-hidden'
      data-testid={`bank-connection-${connection.id}`}
      aria-labelledby={connectionHeadingId}
    >
      <CardHeader className='flex flex-col gap-4 border-b px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6'>
        <div className='flex min-w-0 items-center gap-3'>
          <div
            className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-background text-primary'
            aria-hidden='true'
          >
            <Building2 className='h-5 w-5' />
          </div>
          <div className='min-w-0'>
            <h2 id={connectionHeadingId} className='break-words text-lg font-semibold'>
              {connection.aspspName}
            </h2>
            <p className='mt-1 break-words text-sm text-muted-foreground'>
              {formatCountry(connection.aspspCountry)} <span aria-hidden='true'>·</span>{' '}
              {formatProvider(connection.provider)}
            </p>
          </div>
        </div>
        <div className='flex w-full flex-wrap items-center justify-end gap-x-2 gap-y-2 sm:w-auto'>
          <ConnectionStatus status={connection.status} />
          {connection.lastSyncedAt && <FreshnessLabel value={connection.lastSyncedAt} />}
          {isAuthorized && (
            <Button
              variant='secondary'
              size='sm'
              onClick={syncBank}
              disabled={isSyncing}
              data-testid={`sync-bank-${connection.id}`}
              className='max-sm:min-h-11 max-sm:gap-1 max-sm:px-2'
            >
              <RefreshCw className={isSyncing ? 'animate-slow-spin' : undefined} />
              {isSyncing ? 'Syncing...' : 'Sync now'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className='space-y-6 px-5 py-5 sm:p-6'>
        <div className='grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]'>
          <section aria-labelledby={accountsHeadingId} className='min-w-0'>
            <SectionHeading
              headingId={accountsHeadingId}
              title='Accounts'
              count={connection.bankAccounts.length}
              noun='account'
            />
            {connection.bankAccounts.length === 0 ? (
              <div className='rounded-md border border-dashed px-4 py-5 text-sm text-muted-foreground'>
                No bank accounts were returned.
              </div>
            ) : (
              <div
                className='divide-y rounded-md border'
                data-testid={`bank-accounts-${connection.id}`}
              >
                {connection.bankAccounts.map((account) => (
                  <BankAccountRow key={account.id} account={account} />
                ))}
              </div>
            )}
          </section>

          {isAuthorized && connection.lastSyncedAt && (
            <section aria-labelledby={transactionsHeadingId} className='min-w-0'>
              <SectionHeading
                headingId={transactionsHeadingId}
                title='Recent transactions'
                compactTitle='Transactions'
                count={total}
                noun='transaction'
              />
              {areTransactionsPending ? (
                <div role='status' aria-label='Loading recent transactions'>
                  <Skeleton className='h-24 w-full rounded-md bg-card' />
                </div>
              ) : areTransactionsError ? (
                <div
                  role='alert'
                  className='flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed px-3 py-3 text-sm'
                >
                  <div className='flex min-w-0 items-center gap-2 text-muted-foreground'>
                    <AlertTriangle className='h-4 w-4 shrink-0' aria-hidden='true' />
                    <span>Recent transactions are unavailable.</span>
                  </div>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => void refetchTransactions()}
                    className='max-sm:min-h-11'
                  >
                    Try again
                  </Button>
                </div>
              ) : transactions.length > 0 ? (
                <div
                  className='divide-y rounded-md border'
                  data-testid={`bank-transactions-${connection.id}`}
                >
                  {transactions.map((transaction) => (
                    <BankTransactionRow
                      key={transaction.id}
                      transaction={transaction}
                      onTransactionSelect={onTransactionSelect}
                    />
                  ))}
                </div>
              ) : (
                <div className='rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground'>
                  No transactions were returned.
                </div>
              )}
            </section>
          )}
        </div>

        {(connection.consentValidUntil || connection.lastSyncedAt) && (
          <dl className='grid gap-3 border-t pt-4 text-xs text-muted-foreground sm:grid-cols-2'>
            {connection.consentValidUntil && (
              <div className='min-w-0'>
                <dt className='font-medium text-foreground'>Consent</dt>
                <dd className='mt-1 break-words'>
                  Valid until {formatDate(connection.consentValidUntil)}
                </dd>
              </div>
            )}
            {connection.lastSyncedAt && (
              <div className='min-w-0'>
                <dt className='font-medium text-foreground'>Last synchronized</dt>
                <dd className='mt-1 break-words'>{formatDate(connection.lastSyncedAt)}</dd>
              </div>
            )}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectionStatus({status}: {status: string}) {
  const isAuthorized = status === 'AUTHORIZED';
  const label = formatConnectionStatus(status);
  const textClassName = isAuthorized
    ? 'text-success'
    : status === 'PENDING'
      ? 'text-warning'
      : 'text-muted-foreground';
  const dotClassName = isAuthorized
    ? 'bg-success'
    : status === 'PENDING'
      ? 'bg-warning'
      : 'bg-muted-foreground';

  return (
    <span
      data-testid='bank-connection-status'
      aria-label={`Connection status: ${label}`}
      className={cn(
        'inline-flex shrink-0 items-center gap-2 text-sm font-medium max-sm:text-xs',
        textClassName,
      )}
    >
      <span className='relative flex h-2 w-2 shrink-0' aria-hidden='true'>
        {isAuthorized && (
          <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-success/70 motion-reduce:animate-none' />
        )}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', dotClassName)} />
      </span>
      <span>{label}</span>
    </span>
  );
}

function FreshnessLabel({value}: {value: string}) {
  const isStale = isOlderThan(value, 24 * 60 * 60 * 1000);

  return (
    <span
      data-testid='bank-connection-freshness'
      className={cn(
        'min-w-0 truncate text-right text-xs max-sm:text-[0.6875rem]',
        isStale ? 'text-warning' : 'text-muted-foreground',
      )}
      title={`Last synchronized ${formatDate(value)}`}
    >
      Updated {formatRelativeTime(value)}
    </span>
  );
}

function SectionHeading({
  headingId,
  title,
  compactTitle,
  count,
  noun,
}: {
  headingId: string;
  title: string;
  compactTitle?: string;
  count: number;
  noun: string;
}) {
  return (
    <div className='mb-3 flex items-baseline justify-between gap-3'>
      <h3 id={headingId} className='min-w-0 text-base font-semibold'>
        <span className={compactTitle ? 'max-md:hidden' : undefined}>{title}</span>
        {compactTitle && <span className='hidden max-md:inline'>{compactTitle}</span>}
      </h3>
      <span className='shrink-0 text-xs text-muted-foreground'>
        {count} {count === 1 ? noun : `${noun}s`}
      </span>
    </div>
  );
}

function BankAccountRow({account}: {account: BankConnection['bankAccounts'][number]}) {
  const accountDetails = [
    account.details,
    formatAccountType(account.cashAccountType),
    formatAccountUsage(account.usage),
    account.maskedIdentifier,
  ].filter(Boolean);

  return (
    <div className='min-w-0 p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <p className='break-words font-medium'>
            {account.alias || account.name || 'Bank account'}
          </p>
          <p className='mt-1 break-words text-sm text-muted-foreground'>
            {accountDetails.join(' · ') ||
              'Bank account details will appear after synchronization.'}
          </p>
        </div>
        <Badge variant='outline' className='shrink-0'>
          {account.currency}
        </Badge>
      </div>
      {(account.latestBalances ?? []).length > 0 && (
        <dl className='mt-4 grid min-w-0 grid-cols-2 gap-x-4 gap-y-3'>
          {(account.latestBalances ?? []).map((balance) => (
            <div key={`${account.id}-${balance.balanceType}`} className='min-w-0'>
              <dt className='text-xs uppercase text-muted-foreground'>
                {formatBalanceType(balance.balanceType)}
                {balance.isPrimary ? ' · primary' : ''}
              </dt>
              <dd className='mt-1 text-sm'>
                <CurrencyAmount amount={Number(balance.amount)} currency={balance.currency} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function BankTransactionRow({
  transaction,
  onTransactionSelect,
}: {
  transaction: BankTransaction;
  onTransactionSelect: BankConnectionListProps['onTransactionSelect'];
}) {
  const description = resolveBankTransactionDisplayTitle(transaction);
  const date = formatBankTransactionCompactDate(transaction.bookingDate || transaction.valueDate);
  const metadata = [
    date,
    transaction.transactionStatus && formatBankTransactionStatus(transaction.transactionStatus),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className='grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 p-3 sm:p-4'>
      <div className='min-w-0'>
        <button
          type='button'
          aria-label={`View transaction details for ${description}`}
          onClick={(event) => onTransactionSelect(transaction.id, event.currentTarget)}
          className='block w-full truncate rounded-sm text-left text-sm font-medium text-primary hover:underline hover:underline-offset-2 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          title={description}
        >
          {description}
        </button>
        <p className='truncate text-xs text-muted-foreground'>{metadata}</p>
      </div>
      <div className='text-right'>
        <CurrencyAmount amount={Number(transaction.amount)} currency={transaction.currency} />
      </div>
    </div>
  );
}

function formatConnectionStatus(value: string) {
  const normalized = value.toUpperCase();
  if (normalized === 'AUTHORIZED') return 'Connected';
  if (normalized === 'REVOKED') return 'Disconnected';
  if (normalized === 'PENDING') return 'Pending';
  if (normalized === 'EXPIRED') return 'Expired';
  return formatBankingWords(value);
}

function formatProvider(value: string) {
  return formatBankingWords(value);
}

function formatCountry(value: string) {
  if (value.toUpperCase() === 'NL') return 'Netherlands';
  return value;
}

function formatAccountType(value: string | null) {
  if (!value) return null;
  const normalized = value.toUpperCase();
  if (normalized === 'CACC') return 'Current account';
  if (normalized === 'SVGS') return 'Savings account';
  if (normalized === 'CARD') return 'Card account';
  return formatBankingWords(value);
}

function formatAccountUsage(value: string | null) {
  if (!value) return null;
  const normalized = value.toUpperCase();
  if (normalized === 'PRIV') return 'Personal';
  if (normalized === 'ORGA') return 'Business';
  return formatBankingWords(value);
}

function formatBalanceType(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .toLowerCase();
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'an unknown date'
    : new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(date);
}

function isOlderThan(value: string, milliseconds: number) {
  const timestamp = new Date(value).getTime();
  return !Number.isNaN(timestamp) && Date.now() - timestamp > milliseconds;
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 'unknown';

  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / (60 * 1000)));
  if (elapsedMinutes < 1) return 'just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hr ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`;
}
