import {Building2, Loader, Plus, RefreshCw} from 'lucide-react';
import {toast} from 'sonner';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import {HttpError} from '@/utils/api';
import {formatRetryAfter} from '@/utils/retry-after';

import {useGetBankConnectionTransactions} from '../api/use-get-bank-connection-transactions';
import {useStartBankConnection} from '../api/use-start-bank-connection';
import {useSyncBankConnection} from '../api/use-sync-bank-connection';
import {BankConnection, BankTransaction} from '../types/bank-connection';

type BankConnectionListProps = {
  bankConnections: BankConnection[];
  isPending: boolean;
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
    <Button className={className} onClick={onClick} disabled={isPending} data-testid={testId}>
      {showIcon && (isPending ? <Loader className='animate-slow-spin' /> : <Plus />)}
      {isPending ? 'Connecting...' : `Connect ${targetBank.displayName}`}
    </Button>
  );
}

export function BankConnectionList({bankConnections, isPending}: BankConnectionListProps) {
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

  if (isPending) {
    return <Skeleton className='h-[22rem] w-full rounded-lg bg-card' />;
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-end justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-semibold'>Bank connections</h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            Read-only connections to your financial institutions.
          </p>
        </div>
        <ConnectBankButton
          onClick={connectBank}
          isPending={isStarting}
          testId={targetBank.testId}
          showIcon
        />
      </div>

      {bankConnections.length === 0 ? (
        <Card>
          <CardContent className='flex flex-col items-center py-16 text-center'>
            <Building2 className='mb-5 h-12 w-12 text-muted-foreground' />
            <h2 className='text-xl font-semibold'>No bank connections</h2>
            <p className='mt-2 max-w-md text-sm text-muted-foreground'>
              Connect {targetBank.displayName} to make its available bank accounts part of your
              financial history.
            </p>
            <ConnectBankButton onClick={connectBank} isPending={isStarting} className='mt-6' />
          </CardContent>
        </Card>
      ) : (
        bankConnections.map((connection) => (
          <BankConnectionCard key={connection.id} connection={connection} />
        ))
      )}
    </div>
  );
}

function BankConnectionCard({connection}: {connection: BankConnection}) {
  const isAuthorized = connection.status === 'AUTHORIZED';
  const {syncBankConnection, isPending: isSyncing} = useSyncBankConnection();
  const {
    transactions,
    total,
    isPending: areTransactionsPending,
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
        const transactionLabel = run.transactionsFetched === 1 ? 'transaction' : 'transactions';
        const balanceLabel = run.balancesFetched === 1 ? 'balance' : 'balances';

        toast.success('Bank connection synchronized', {
          description: `${run.transactionsFetched} ${transactionLabel} and ${run.balancesFetched} ${balanceLabel} fetched.`,
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
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-4'>
        <div>
          <CardTitle className='text-lg'>{connection.aspspName}</CardTitle>
          <CardDescription>
            {connection.aspspCountry} | {connection.provider}
          </CardDescription>
        </div>
        <div className='flex flex-col items-end gap-2'>
          <Badge variant={isAuthorized ? 'default' : 'outline'}>{connection.status}</Badge>
          {isAuthorized && (
            <Button
              variant='secondary'
              size='sm'
              onClick={syncBank}
              disabled={isSyncing}
              data-testid={`sync-bank-${connection.id}`}
            >
              <RefreshCw className={isSyncing ? 'animate-slow-spin' : undefined} />
              {isSyncing ? 'Syncing...' : 'Sync now'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {connection.bankAccounts.length === 0 ? (
          <p className='text-sm text-muted-foreground'>No bank accounts were returned.</p>
        ) : (
          <div className='divide-y rounded-md border'>
            {connection.bankAccounts.map((account) => (
              <div key={account.id} className='flex items-center justify-between gap-4 p-4'>
                <div className='min-w-0 flex-1'>
                  <p className='font-medium'>{account.alias || account.name || 'Bank account'}</p>
                  <p className='text-sm text-muted-foreground'>
                    {[account.details, account.cashAccountType, account.usage]
                      .filter(Boolean)
                      .join(' | ') || 'Bank account details will appear after synchronization.'}
                  </p>
                  {(account.latestBalances ?? []).length > 0 && (
                    <div className='mt-3 flex flex-wrap gap-x-6 gap-y-2'>
                      {(account.latestBalances ?? []).map((balance) => (
                        <div key={`${account.id}-${balance.balanceType}`}>
                          <p className='text-xs uppercase text-muted-foreground'>
                            {formatBalanceType(balance.balanceType)}
                            {balance.isPrimary ? ' · primary' : ''}
                          </p>
                          <p className='text-sm'>
                            <CurrencyAmount
                              amount={Number(balance.amount)}
                              currency={balance.currency}
                            />
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <Badge variant='outline'>{account.currency}</Badge>
              </div>
            ))}
          </div>
        )}
        {isAuthorized && connection.lastSyncedAt && (
          <div className='mt-4'>
            <div className='mb-2 flex items-center justify-between gap-4'>
              <p className='text-sm font-medium'>Recent transactions</p>
              {total > 0 && <p className='text-xs text-muted-foreground'>{total} total</p>}
            </div>
            {areTransactionsPending ? (
              <Skeleton className='h-24 w-full rounded-md bg-card' />
            ) : transactions.length > 0 ? (
              <div
                className='divide-y rounded-md border'
                data-testid={`bank-transactions-${connection.id}`}
              >
                {transactions.map((transaction) => (
                  <BankTransactionRow key={transaction.id} transaction={transaction} />
                ))}
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>No transactions were returned.</p>
            )}
          </div>
        )}
        {connection.consentValidUntil && (
          <p className='mt-4 text-xs text-muted-foreground'>
            Consent valid until {formatDate(connection.consentValidUntil)}
          </p>
        )}
        {connection.lastSyncedAt && (
          <p className='mt-1 text-xs text-muted-foreground'>
            Last synchronized {formatDate(connection.lastSyncedAt)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BankTransactionRow({transaction}: {transaction: BankTransaction}) {
  return (
    <div className='flex items-center justify-between gap-4 p-3'>
      <div className='min-w-0'>
        <p className='truncate text-sm font-medium'>
          {transaction.description || transaction.counterpartyName || 'Transaction'}
        </p>
        <p className='truncate text-xs text-muted-foreground'>
          {[transaction.bookingDate || transaction.valueDate, transaction.transactionStatus]
            .filter(Boolean)
            .join(' | ')}
        </p>
      </div>
      <CurrencyAmount amount={Number(transaction.amount)} currency={transaction.currency} />
    </div>
  );
}

function formatBalanceType(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .toLowerCase();
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'an unknown date' : date.toLocaleString();
}
