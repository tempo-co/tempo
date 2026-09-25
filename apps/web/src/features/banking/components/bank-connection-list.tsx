import {AlertTriangle, Building2, ChevronDown, Loader, RefreshCw, Trash2} from 'lucide-react';
import {useMemo, useState} from 'react';
import {toast} from 'sonner';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';
import {Skeleton} from '@/components/ui/skeleton';
import {HttpError} from '@/utils/api';
import {cn} from '@/utils/cn';

import {useDeleteBankConnection} from '../api/use-delete-bank-connection';
import {useGetBankConnectionTransactions} from '../api/use-get-bank-connection-transactions';
import {useGetSupportedBanks} from '../api/use-get-supported-banks';
import {useStartBankConnection} from '../api/use-start-bank-connection';
import {BankConnection, BankConnectionAspsp, BankTransaction} from '../types/bank-connection';
import {
  type AutomaticSyncDetails,
  getAutomaticSyncDetailsForConnection,
  isReauthorizationRequired,
} from '../utils/bank-sync-status';
import {
  formatBankTransactionCashFlowTreatment,
  formatBankTransactionCompactDate,
  formatBankTransactionFinancialEvent,
  formatBankingWords,
  resolveBankTransactionDisplayTitle,
} from '../utils/formatters';
import {BankConnectionPicker} from './bank-connection-picker';
import {BankLogo} from './bank-logo';

type BankConnectionListProps = {
  bankConnections: BankConnection[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onTransactionSelect: (transactionId: BankTransaction['id'], trigger: HTMLButtonElement) => void;
};

function aspspKey(name: string, country: string) {
  return `${country.trim().toUpperCase()}:${name.trim().toLowerCase()}`;
}

function formatConnectionCount(count: number) {
  return `${count} ${count === 1 ? 'connection' : 'connections'}`;
}

const DESTRUCTIVE_CONNECTION_STATUSES = ['AUTHORIZED', 'EXPIRED'] as const;
const REMOVABLE_CONNECTION_STATUSES = [
  'PENDING_AUTHORIZATION',
  'FAILED',
  'CANCELLED',
  ...DESTRUCTIVE_CONNECTION_STATUSES,
] as const;

function ConnectionPageFrame({
  children,
  connectBank,
  connectionCount,
  isStarting,
  showConnect = true,
}: {
  children: React.ReactNode;
  connectBank: (bank: BankConnectionAspsp) => void | Promise<void>;
  connectionCount: number;
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
          <h1 className='text-2xl font-semibold tracking-tight'>Bank connections</h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            {formatConnectionCount(connectionCount)}
          </p>
        </div>
        {showConnect && (
          <BankConnectionPicker
            onBankSelect={connectBank}
            isStarting={isStarting}
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
  const {supportedBanks} = useGetSupportedBanks(!isPending && !isError);
  const bankLogos = useMemo(() => {
    const logos = new Map<string, string>();
    for (const bank of supportedBanks ?? []) {
      if (bank.logoUrl) logos.set(aspspKey(bank.name, bank.country), bank.logoUrl);
    }
    return logos;
  }, [supportedBanks]);

  const connectBank = async (bank: BankConnectionAspsp) => {
    try {
      const {authorizationUrl} = await startBankConnection({
        aspspName: bank.name,
        aspspCountry: bank.country,
      });
      window.location.assign(authorizationUrl);
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) return;
      toast.error('Unable to add bank connection', {
        description: 'Please try again in a moment.',
        id: 'bank-connection-start-failed',
      });
    }
  };

  const reauthorizeBank = (connection: BankConnection) =>
    connectBank({name: connection.aspspName, country: connection.aspspCountry});

  return (
    <ConnectionPageFrame
      connectBank={connectBank}
      connectionCount={bankConnections.length}
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
              Connect a supported bank to make its available bank accounts part of your financial
              history.
            </p>
          </CardContent>
        </Card>
      ) : (
        bankConnections.map((connection) => (
          <BankConnectionCard
            key={connection.id}
            connection={connection}
            logoUrl={bankLogos.get(aspspKey(connection.aspspName, connection.aspspCountry))}
            isStarting={isStarting}
            onReauthorize={reauthorizeBank}
            onTransactionSelect={onTransactionSelect}
          />
        ))
      )}
    </ConnectionPageFrame>
  );
}

function BankConnectionCard({
  connection,
  logoUrl,
  isStarting,
  onReauthorize,
  onTransactionSelect,
}: {
  connection: BankConnection;
  logoUrl?: string;
  isStarting: boolean;
  onReauthorize: (connection: BankConnection) => void | Promise<void>;
  onTransactionSelect: BankConnectionListProps['onTransactionSelect'];
}) {
  const isAuthorized = connection.status === 'AUTHORIZED';
  const isRemovable = isRemovableConnection(connection.status);
  const isDestructive = isDestructiveConnection(connection.status);
  // Collapsed by default: the header already carries state, so the body is opt-in.
  // Cards without a collapsible body render expanded without a toggle.
  const [isExpanded, setIsExpanded] = useState(false);
  const connectionHeadingId = `bank-connection-${connection.id}-heading`;
  const accountsHeadingId = `bank-connection-${connection.id}-accounts`;
  const transactionsHeadingId = `bank-connection-${connection.id}-transactions`;
  const disclosureContentId = `bank-connection-${connection.id}-content`;
  const metadataHeadingId = `bank-connection-${connection.id}-meta`;
  const {deleteBankConnection, isPending: isRemoving} = useDeleteBankConnection();
  const {
    transactions,
    total,
    isPending: areTransactionsPending,
    isError: areTransactionsError,
    refetch: refetchTransactions,
  } = useGetBankConnectionTransactions(
    connection.id,
    isAuthorized && !!connection.lastSyncedAt,
    connection.lastSyncedAt,
  );

  const hasBodyContent =
    connection.bankAccounts.length > 0 ||
    (isAuthorized && !!connection.lastSyncedAt) ||
    Boolean(connection.consentValidUntil);

  // Sync status is only a card when it needs attention; that warning must stay
  // discoverable even while the card is collapsed, so it renders as a strip
  // between the header and footer.
  const syncDetails = getAutomaticSyncDetailsForConnection(connection);

  const removeBank = async (): Promise<boolean> => {
    try {
      await deleteBankConnection(connection.id, isDestructive ? 'DELETE' : undefined);
      toast.success('Bank connection removed', {
        id: `bank-connection-removed-${connection.id}`,
      });
      return true;
    } catch {
      toast.error('Unable to remove bank connection', {
        description: 'Please try again in a moment.',
        id: `bank-connection-remove-failed-${connection.id}`,
      });
      return false;
    }
  };

  const headerMeta = [
    formatCountry(connection.aspspCountry),
    <ConnectionStatus key='status' status={connection.status} />,
    connection.lastSyncedAt && <FreshnessLabel key='freshness' value={connection.lastSyncedAt} />,
  ].filter(Boolean) as React.ReactNode[];

  return (
    <Card
      className='overflow-hidden'
      data-testid={`bank-connection-${connection.id}`}
      aria-labelledby={connectionHeadingId}
    >
      <CardHeader
        className={cn(
          'relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-0',
          hasBodyContent && 'sm:flex-row sm:gap-0',
        )}
      >
        {hasBodyContent ? (
          <button
            type='button'
            onClick={() => setIsExpanded((open) => !open)}
            aria-expanded={isExpanded}
            aria-controls={disclosureContentId}
            data-testid={`connection-card-toggle-${connection.id}`}
            className={cn(
              'flex w-full min-w-0 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:self-auto',
              isReauthorizationRequired(connection) && 'sm:w-[calc(100%-8.5rem)] sm:shrink',
            )}
          >
            <ConnectionCardHeaderContent
              connection={connection}
              logoUrl={logoUrl}
              connectionHeadingId={connectionHeadingId}
              headerMeta={headerMeta}
            />
            <ChevronDown
              aria-hidden='true'
              className={cn(
                'ml-2 mr-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                isReauthorizationRequired(connection) ? 'sm:ml-1' : 'text-muted-foreground',
                !isExpanded && '-rotate-90',
              )}
            />
          </button>
        ) : (
          <div className='flex min-w-0 flex-1 items-center gap-3'>
            <ConnectionCardHeaderContent
              connection={connection}
              logoUrl={logoUrl}
              connectionHeadingId={connectionHeadingId}
              headerMeta={headerMeta}
            />
          </div>
        )}
        {isReauthorizationRequired(connection) && (
          <Button
            variant='outline'
            size='sm'
            onClick={() => void onReauthorize(connection)}
            disabled={isStarting}
            className='max-sm:min-h-11 max-sm:gap-1 max-sm:self-end max-sm:px-2'
          >
            {isStarting ? 'Starting...' : 'Re-authorize'}
          </Button>
        )}
      </CardHeader>
      {!isExpanded && syncDetails?.isProblem && <AutomaticSyncStatus details={syncDetails} />}
      {isExpanded && (
        <CardContent
          id={disclosureContentId}
          aria-labelledby={
            connection.consentValidUntil || connection.lastSyncedAt ? metadataHeadingId : undefined
          }
          className='space-y-6 px-4 pb-5 pt-4'
        >
          {syncDetails?.isProblem && <AutomaticSyncStatus details={syncDetails} />}
          <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
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
        </CardContent>
      )}
      {(connection.consentValidUntil || isRemovable) && (!hasBodyContent || isExpanded) && (
        <footer
          aria-labelledby={connection.consentValidUntil ? metadataHeadingId : undefined}
          className='flex min-w-0 items-center justify-between gap-2 border-t px-4 pb-4 pt-3 text-xs text-muted-foreground'
        >
          {connection.consentValidUntil && (
            <h3 id={metadataHeadingId} className='sr-only'>
              Bank connection details
            </h3>
          )}
          {connection.consentValidUntil && <ConsentBadge value={connection.consentValidUntil} />}
          {isRemovable &&
            (isDestructive ? (
              <DestructiveBankConnectionFooterButton
                connection={connection}
                isPending={isRemoving}
                onConfirm={removeBank}
              />
            ) : (
              <RemoveConnectionButton
                connectionId={connection.id}
                isPending={isRemoving}
                onClick={() => void removeBank()}
              />
            ))}
        </footer>
      )}
    </Card>
  );
}

function ConnectionCardHeaderContent({
  connection,
  logoUrl,
  connectionHeadingId,
  headerMeta,
}: {
  connection: BankConnection;
  logoUrl?: string;
  connectionHeadingId: string;
  headerMeta: React.ReactNode[];
}) {
  return (
    <>
      <BankLogo
        bank={{name: connection.aspspName, logoUrl}}
        className='h-[64px] w-[64px]'
        testId='bank-connection-logo'
      />
      <span className='min-w-0 flex-1'>
        <div className='grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 max-sm:grid-cols-1 max-sm:gap-y-1'>
          <h2
            id={connectionHeadingId}
            className='min-w-0 break-words text-lg font-semibold leading-tight'
          >
            {connection.aspspName}
          </h2>
          <ConnectionBalanceSummary
            accounts={connection.bankAccounts}
            className='justify-end text-right max-sm:justify-start max-sm:text-left sm:shrink-0'
          />
        </div>
        <p className='mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground'>
          {headerMeta.map((item, index) => (
            <span key={index} className='inline-flex min-w-0 shrink-0 items-center'>
              {item}
            </span>
          ))}
        </p>
      </span>
    </>
  );
}

function ConsentBadge({value}: {value: string}) {
  const isExpiringSoon = isExpiringWithinThirtyDays(value);

  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-2 text-xs',
        isExpiringSoon && 'text-warning',
      )}
      title={`Consent valid until ${formatDate(value)}`}
    >
      {isExpiringSoon && (
        <span
          aria-hidden='true'
          className='inline-block h-2 w-2 shrink-0 rounded-full bg-warning'
        />
      )}
      Consent valid until {formatDate(value)}
    </span>
  );
}

function RemoveConnectionButton({
  connectionId,
  isPending,
  onClick,
}: {
  connectionId: string;
  isPending: boolean;
  onClick?: () => void;
}) {
  return (
    <Button
      variant='ghost'
      size='icon'
      onClick={onClick}
      disabled={isPending}
      aria-label='Remove connection'
      data-testid={`remove-bank-${connectionId}`}
      className='h-11 w-11 text-muted-foreground'
    >
      <Trash2 />
      <span className='sr-only'>Remove connection</span>
    </Button>
  );
}

function DestructiveBankConnectionFooterButton({
  connection,
  isPending,
  onConfirm,
}: {
  connection: BankConnection;
  isPending: boolean;
  onConfirm: () => Promise<boolean>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const canConfirm = confirmation === 'DELETE' && !isPending;

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) setConfirmation('');
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    if (await onConfirm()) handleOpenChange(false);
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={handleOpenChange}>
      <ResponsiveDialogTrigger asChild>
        <RemoveConnectionButton connectionId={connection.id} isPending={isPending} />
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className='md:w-[30rem]'>
        <ResponsiveDialogHeader className='text-start'>
          <ResponsiveDialogTitle>Remove connected bank?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='pt-2'>
            This permanently deletes the {connection.aspspName} connection, all linked bank
            accounts, and all transactions. This cannot be undone.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <form
            className='grid items-start gap-4'
            onSubmit={(event) => {
              event.preventDefault();
              void handleConfirm();
            }}
          >
            <div className='grid gap-2'>
              <label
                htmlFor={`remove-bank-confirmation-${connection.id}`}
                className='text-sm font-medium'
              >
                Type DELETE to confirm
              </label>
              <Input
                id={`remove-bank-confirmation-${connection.id}`}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete='off'
                disabled={isPending}
                data-testid={`remove-bank-confirmation-${connection.id}`}
              />
            </div>
            <div className='mt-2 flex flex-col justify-end gap-4 pb-4 md:flex-row md:pb-0'>
              <Button
                type='submit'
                variant='destructive'
                disabled={!canConfirm}
                className='order-1 text-foreground md:order-2'
                data-testid={`remove-bank-confirm-${connection.id}`}
              >
                {isPending ? (
                  <>
                    <span>Removing...</span>
                    <Loader className='ml-2 h-4 w-4 animate-slow-spin' />
                  </>
                ) : (
                  'Remove permanently'
                )}
              </Button>
              <ResponsiveDialogClose asChild className='order-2 md:order-1'>
                <Button variant='outline' type='button'>
                  Cancel
                </Button>
              </ResponsiveDialogClose>
            </div>
          </form>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
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
        'inline-flex shrink-0 items-center gap-1.5 font-medium max-sm:text-xs',
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
      className={cn('min-w-0 truncate', isStale ? 'text-warning' : 'text-muted-foreground')}
      title={`Last synchronized ${formatDate(value)}`}
    >
      Updated {formatRelativeTime(value)}
    </span>
  );
}

function AutomaticSyncStatus({details}: {details: AutomaticSyncDetails | null}) {
  if (!details?.isProblem) return null;

  // Background sync is automatic and silent by design: only surface it when it
  // actually needs attention (rate-limited, overdue, failed, expired consent).
  return (
    <div
      data-testid='bank-connection-sync-status'
      role='alert'
      className='rounded-md border border-warning/40 bg-warning/5 px-3 py-3 text-sm'
    >
      <p className='font-medium'>{details.title}</p>
      <p className='mt-1 text-muted-foreground'>{details.description}</p>
    </div>
  );
}

function ConnectionBalanceSummary({
  accounts,
  className,
}: {
  accounts: BankConnection['bankAccounts'];
  className?: string;
}) {
  const totals = summarizeConnectionBalances(accounts);
  if (totals.length === 0) return null;

  return (
    <span
      className={cn(
        'flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm max-sm:gap-x-4 max-sm:text-xs',
        className,
      )}
      data-testid='bank-connection-total'
      role='group'
      aria-label={`Connection balances: ${totals.map(({currency, amount}) => `${amount} ${currency}`).join(', ')}`}
    >
      {totals.map(({currency, amount}) => (
        <span key={currency} className='inline-flex shrink-0 items-baseline'>
          <CurrencyAmount amount={amount} currency={currency} />
        </span>
      ))}
    </span>
  );
}

function getPrimaryBalance(account: BankConnection['bankAccounts'][number]) {
  const balances = account.latestBalances ?? [];
  return balances.find((balance) => balance.isPrimary) ?? balances[0];
}

function summarizeConnectionBalances(accounts: BankConnection['bankAccounts']) {
  const totals = new Map<string, number>();

  for (const account of accounts) {
    const primaryBalance = getPrimaryBalance(account);
    const currentAmount = account.currentBalanceAmount?.trim();
    const amountValue = currentAmount || primaryBalance?.amount;
    if (!amountValue) continue;

    const amount = Number(amountValue);
    if (!Number.isFinite(amount)) continue;

    const currency = currentAmount
      ? account.currency
      : (primaryBalance?.currency ?? account.currency);
    totals.set(currency, (totals.get(currency) ?? 0) + amount);
  }

  return Array.from(totals, ([currency, amount]) => ({currency, amount}));
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
  const primaryBalance = getPrimaryBalance(account);

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
      {primaryBalance && (
        <dl className='mt-4 min-w-0'>
          <div className='min-w-0'>
            <dt className='sr-only'>Account balance</dt>
            <dd className='text-sm'>
              <CurrencyAmount
                amount={Number(primaryBalance.amount)}
                currency={primaryBalance.currency}
              />
            </dd>
          </div>
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
  const metadata = formatBankTransactionCompactDate(
    transaction.bookingDate || transaction.valueDate,
  );
  const financialEvent = formatBankTransactionFinancialEvent(transaction.financialEventType);

  return (
    <button
      type='button'
      aria-label={`View transaction details for ${description}`}
      onClick={(event) => onTransactionSelect(transaction.id, event.currentTarget)}
      data-testid={`bank-transaction-row-${transaction.id}`}
      className='grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-sm p-3 text-left transition-colors hover:bg-accent/70 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-sm:min-h-11 sm:p-4'
    >
      <span className='block min-w-0'>
        <span className='block truncate text-sm font-medium'>{description}</span>
        <span className='block truncate text-xs text-muted-foreground'>{metadata}</span>
        {financialEvent && (
          <span className='block truncate text-xs text-foreground'>
            {financialEvent}
            <span aria-hidden='true'> · </span>
            {formatBankTransactionCashFlowTreatment(transaction.cashFlowTreatment)}
          </span>
        )}
      </span>
      <span className='text-right'>
        <CurrencyAmount amount={Number(transaction.amount)} currency={transaction.currency} />
      </span>
    </button>
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

function isRemovableConnection(status: string) {
  return REMOVABLE_CONNECTION_STATUSES.includes(
    status.toUpperCase() as (typeof REMOVABLE_CONNECTION_STATUSES)[number],
  );
}

function isDestructiveConnection(status: string) {
  return DESTRUCTIVE_CONNECTION_STATUSES.includes(
    status.toUpperCase() as (typeof DESTRUCTIVE_CONNECTION_STATUSES)[number],
  );
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

function isExpiringWithinThirtyDays(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;

  const remaining = timestamp - Date.now();
  return remaining > 0 && remaining < 30 * 24 * 60 * 60 * 1000;
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
