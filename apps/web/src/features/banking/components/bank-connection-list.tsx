import {useIsMutating} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {BankConnection, BankConnectionAspsp} from '@tempo/contracts';
import {format} from 'date-fns';
import {
  AlertTriangle,
  Building2,
  ChevronRight,
  Clock,
  CreditCard,
  Landmark,
  PiggyBank,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';

import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {PendingLabel} from '@/components/shared/pending-label';
import {TextAction} from '@/components/shared/text-action';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {Skeleton} from '@/components/ui/skeleton';
import {wasToasted} from '@/utils/api';
import {cn} from '@/utils/cn';
import {formatCurrency} from '@/utils/format-currency';

import {type BankLogos, bankLogoKey, useBankLogos} from '../api/use-bank-logos';
import {
  DELETE_BANK_CONNECTION_KEY,
  useDeleteBankConnection,
} from '../api/use-delete-bank-connection';
import {useBankConnectionRefreshState} from '../api/use-refresh-bank-connection';
import {useStartBankConnection} from '../api/use-start-bank-connection';
import {
  getAutomaticSyncProblemForConnection,
  isConnectedBank,
  isConsentEndingSoon,
  isReauthorizationRequired,
  isSyncInProgress,
} from '../utils/bank-sync-status';
import {formatBankingWords} from '../utils/formatters';
import {BankConnectionPicker} from './bank-connection-picker';
import {BankLogo} from './bank-logo';

type BankConnectionListProps = {
  bankConnections: BankConnection[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
};

type Account = BankConnection['bankAccounts'][number];

const DESTRUCTIVE_CONNECTION_STATUSES = ['AUTHORIZED', 'EXPIRED'] as const;
const DAY = 24 * 60 * 60 * 1000;

/** The shared transaction row: 36px round tile, two lines, amount; 60px tall. */
const ROW =
  'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';
const TILE =
  'inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-transaction-tile-edge bg-transaction-tile-field text-transaction-tile-ink';

export function BankConnectionList({
  bankConnections,
  isPending,
  isError,
  onRetry,
}: BankConnectionListProps) {
  const {startBankConnection, isPending: isStarting} = useStartBankConnection();
  const bankLogos = useBankLogos(!isPending && !isError);
  // Which bank the Details dialog shows, and whether it is open; closing keeps the bank so it fades out whole.
  const [details, setDetails] = useState<{id: string; open: boolean} | null>(null);
  const detailsConnection =
    bankConnections.find((connection) => connection.id === details?.id) ?? null;
  const detailsOpen = Boolean(details?.open && detailsConnection);
  const detailsOpener = useRef<HTMLButtonElement | null>(null);
  const closeDetails = (connectionId?: string) =>
    setDetails((current) =>
      current && (!connectionId || current.id === connectionId)
        ? {...current, open: false}
        : current,
    );

  // The dialog has no trigger of its own: once it has closed, focus returns to the Details button.
  useEffect(() => {
    if (detailsOpen) return;
    const timer = window.setTimeout(() => {
      if (detailsOpener.current?.isConnected) detailsOpener.current.focus();
      detailsOpener.current = null;
    }, 300);
    return () => window.clearTimeout(timer);
  }, [detailsOpen]);

  const connectBank = async (bank: BankConnectionAspsp) => {
    try {
      const {authorizationUrl} = await startBankConnection({
        aspspName: bank.name,
        aspspCountry: bank.country,
      });
      window.location.assign(authorizationUrl);
    } catch (error) {
      if (wasToasted(error)) return;
      toast.error('Unable to add bank connection', {
        description: 'Please try again in a moment.',
        id: 'bank-connection-start-failed',
      });
    }
  };

  const reauthorize = (connection: BankConnection) =>
    connectBank({name: connection.aspspName, country: connection.aspspCountry});

  return (
    <div
      className='@container grid grid-cols-1 gap-6 max-md:gap-4'
      data-testid='bank-connections-list'
    >
      <header className='flex flex-wrap items-center justify-between gap-x-4 gap-y-3'>
        <h1 className='text-page-title'>Bank connections</h1>
        {/* Always there: loading, retrying or failing to load the list never closes an open sheet. */}
        <BankConnectionPicker onBankSelect={connectBank} isStarting={isStarting} />
      </header>
      {isPending ? (
        <div
          className='grid grid-cols-1 items-start gap-6 max-md:gap-4 @[60rem]:grid-cols-2'
          role='status'
          aria-label='Loading bank connections'
          data-testid='bank-connections-loading'
        >
          <Skeleton className='h-80 rounded-card bg-card' />
          <Skeleton className='h-48 rounded-card bg-card' />
        </div>
      ) : isError ? (
        <div role='alert'>
          <EmptyState
            tone='error'
            icon={RefreshCw}
            title='Could not load bank connections'
            description='The connection service did not respond. Try again in a moment.'
          >
            <Button
              variant='outline'
              onClick={onRetry}
              className='min-h-11'
              data-testid='bank-connections-retry'
            >
              Try again
            </Button>
          </EmptyState>
        </div>
      ) : bankConnections.length === 0 ? (
        <EmptyState
          icon={Building2}
          title='No bank connections'
          description='Connect a bank to bring its accounts into Tempo.'
        />
      ) : (
        // Two columns that each flow top to bottom, so a short card leaves neither a gap below it nor empty room inside it.
        <div className='grid grid-cols-1 gap-6 max-md:gap-4 @[60rem]:block @[60rem]:columns-2 @[60rem]:[&>*]:mb-6 @[60rem]:[&>*]:break-inside-avoid'>
          {sortByAttention(bankConnections).map((connection) => (
            <BankCard
              key={connection.id}
              connection={connection}
              logoUrl={bankLogos[bankLogoKey(connection.aspspName, connection.aspspCountry)]}
              isStarting={isStarting}
              onReauthorize={reauthorize}
              onDetails={(trigger) => {
                detailsOpener.current = trigger;
                setDetails({id: connection.id, open: true});
              }}
            />
          ))}
        </div>
      )}
      <BankDetailsDialog
        open={detailsOpen}
        connection={detailsConnection}
        bankLogos={bankLogos}
        isStarting={isStarting}
        onReauthorize={reauthorize}
        onClose={() => closeDetails()}
        onRemoved={closeDetails}
      />
    </div>
  );
}

/** Banks that need something come first; the rest keep the API's order. */
function sortByAttention(connections: BankConnection[]) {
  return [...connections].sort(
    (a, b) => Number(Boolean(problemOf(b))) - Number(Boolean(problemOf(a))),
  );
}

type Problem = {
  title: string;
  detail: string;
  action: 'reauthorize' | null;
  /** Still working, with time to act; everything else has already stopped something. */
  soon?: boolean;
};

/** The one thing wrong with a bank, if anything: what it is, when, and what to do. */
function problemOf(connection: BankConnection): Problem | null {
  if (!isConnectedBank(connection)) {
    return {
      title: 'Not connected',
      detail: 'The bank did not finish authorizing',
      action: 'reauthorize',
    };
  }
  if (isReauthorizationRequired(connection)) {
    return {
      title: 'Consent expired',
      detail: connection.lastSyncedAt
        ? `No updates since ${shortDate(connection.lastSyncedAt)}`
        : 'Automatic sync has stopped',
      action: 'reauthorize',
    };
  }
  if (isConsentEndingSoon(connection) && connection.consentValidUntil) {
    return {
      title: `Consent ends ${relativeDays(connection.consentValidUntil)}`,
      detail: 'Re-authorize to keep syncing',
      action: 'reauthorize',
      soon: true,
    };
  }
  const sync = getAutomaticSyncProblemForConnection(connection);
  if (sync) {
    return {
      title: sync.title.replace('Automatic sync needs attention', 'Sync failed'),
      detail: [
        connection.lastSyncedAt && `No updates since ${shortDate(connection.lastSyncedAt)}`,
        'retries on its own',
      ]
        .filter(Boolean)
        .join(' · '),
      action: null,
    };
  }
  return null;
}

function BankCard({
  connection,
  logoUrl,
  isStarting,
  onReauthorize,
  onDetails,
}: {
  connection: BankConnection;
  logoUrl?: string;
  isStarting: boolean;
  onReauthorize: (connection: BankConnection) => void | Promise<void>;
  onDetails: (trigger: HTMLButtonElement) => void;
}) {
  const headingId = `bank-connection-${connection.id}-heading`;
  const problem = problemOf(connection);
  const accounts = connection.bankAccounts;
  const total = bankTotal(connection);
  const stale = !problem && isStale(connection);

  return (
    <Card
      role='region'
      aria-labelledby={headingId}
      data-testid={`bank-connection-${connection.id}`}
      className='grid grid-cols-1 content-start gap-4 p-5 sm:p-6'
    >
      <header className='flex items-center gap-3'>
        <BankLogo
          bank={{name: connection.aspspName, logoUrl}}
          className='size-9 rounded-md text-xs shadow-none'
          imageClassName='p-1'
          testId='bank-connection-logo'
        />
        <div className='min-w-0 flex-1'>
          <h2 id={headingId} className='text-card-title wrap-break-word'>
            {connection.aspspName}
          </h2>
          <p className={cn('truncate text-xs text-muted-foreground', stale && 'text-warning')}>
            {stale
              ? `Updated ${relativeTime(connection.lastSyncedAt!)}`
              : `${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'}`}
          </p>
        </div>
        <TextAction
          onClick={(event) => onDetails(event.currentTarget)}
          aria-label={`${connection.aspspName} details`}
          className='-mr-2 gap-0.5 self-center'
        >
          Details <ChevronRight aria-hidden='true' />
        </TextAction>
      </header>

      {problem && (
        <div
          role='alert'
          data-testid='bank-connection-problem'
          className='grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]'
        >
          {problem.soon ? (
            <Clock aria-hidden='true' className='size-4 text-warning' />
          ) : (
            <AlertTriangle aria-hidden='true' className='size-4 text-warning' />
          )}
          <span className='min-w-0'>
            <span className='block text-sm font-medium'>{problem.title}</span>
            <span className='block text-xs text-muted-foreground'>{problem.detail}</span>
          </span>
          {problem.action === 'reauthorize' && (
            <Button
              variant='outline'
              size='sm'
              disabled={isStarting}
              onClick={() => void onReauthorize(connection)}
              className='col-start-2 justify-self-start sm:col-start-3 pointer-coarse:min-h-11'
            >
              {isStarting ? 'Starting…' : 'Re-authorize'}
            </Button>
          )}
        </div>
      )}

      {accounts.length > 0 && (
        <ul className='-mx-3 grid grid-cols-1'>
          {accounts.map((account) => (
            <li key={account.id}>
              <AccountRow account={account} baseCurrency={connection.baseCurrency} />
            </li>
          ))}
          {accounts.length > 1 && total && (
            <li
              data-testid='bank-connection-total'
              className='mx-3 flex items-baseline justify-between gap-3 border-t pt-3 text-sm text-muted-foreground'
            >
              <span>Total</span>
              <span className='numeric'>{formatCurrency(total.amount, total.currency)}</span>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

function AccountRow({account, baseCurrency}: {account: Account; baseCurrency: string | null}) {
  const balance = accountBalance(account);
  const converted =
    balance?.amount !== 0 &&
    baseCurrency &&
    account.currency !== baseCurrency &&
    account.currentBalanceInBaseCurrency
      ? formatCurrency(Number(account.currentBalanceInBaseCurrency), baseCurrency)
      : null;
  const name = accountName(account);
  const type = formatAccountType(account.cashAccountType);
  const subline = [type !== name && type, lastDigits(account)].filter(Boolean).join(' · ');

  return (
    <Link
      to='/bank-transactions'
      search={{bankAccountIds: [account.id]}}
      aria-label={`${name} transactions`}
      className={ROW}
    >
      <span aria-hidden='true' className={TILE}>
        <AccountTypeIcon type={account.cashAccountType} />
      </span>
      <span className='min-w-0'>
        <span className='block truncate text-sm'>{name}</span>
        <span className='block truncate text-xs text-muted-foreground'>
          {subline || account.currency}
        </span>
      </span>
      <span className='text-right'>
        {balance && (
          <span className='block numeric text-sm whitespace-nowrap'>
            {formatCurrency(balance.amount, balance.currency)}
          </span>
        )}
        {converted && (
          <span className='block numeric text-xs whitespace-nowrap text-muted-foreground'>
            ≈ {converted}
          </span>
        )}
      </span>
    </Link>
  );
}

function BankDetailsDialog({
  open,
  connection: current,
  bankLogos,
  isStarting,
  onReauthorize,
  onClose,
  onRemoved,
}: {
  open: boolean;
  connection: BankConnection | null;
  bankLogos: BankLogos;
  isStarting: boolean;
  onReauthorize: (connection: BankConnection) => void | Promise<void>;
  onClose: () => void;
  onRemoved: (connectionId: string) => void;
}) {
  // The last bank shown stays rendered while the dialog closes, even once it has been removed.
  const [shown, setShown] = useState(current);
  if (current && current !== shown) setShown(current);
  const connection = current ?? shown;
  // The connection whose removal step is showing; every opening starts on the details.
  const [removing, setRemoving] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setRemoving(null);
  }
  const step = connection && removing === connection.id ? 'remove' : 'details';

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => next || onClose()}>
      <ResponsiveDialogContent className='md:w-120'>
        {/* While it fades out, the dialog shows its bank but takes no more input. */}
        <div inert={!open} className='contents'>
          {connection &&
            (step === 'details' ? (
              <DetailsStep
                connection={connection}
                logoUrl={bankLogos[bankLogoKey(connection.aspspName, connection.aspspCountry)]}
                isStarting={isStarting}
                onReauthorize={onReauthorize}
                onRemove={() => setRemoving(connection.id)}
              />
            ) : (
              <RemoveStep
                connection={connection}
                onBack={() => setRemoving(null)}
                onRemoved={() => onRemoved(connection.id)}
              />
            ))}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function DetailsStep({
  connection,
  logoUrl,
  isStarting,
  onReauthorize,
  onRemove,
}: {
  connection: BankConnection;
  logoUrl?: string;
  isStarting: boolean;
  onReauthorize: (connection: BankConnection) => void | Promise<void>;
  onRemove: () => void;
}) {
  const consent = connection.consentValidUntil;
  const consentSoon = consent ? isWithinDays(consent, 30) : false;
  const canReauthorize =
    !isConnectedBank(connection) ||
    isReauthorizationRequired(connection) ||
    isConsentEndingSoon(connection);
  const facts: {label: string; value: string; warn?: boolean}[] = [
    {label: 'Country', value: formatCountry(connection.aspspCountry)},
    {
      label: 'Accounts',
      value: String(connection.bankAccounts.length),
    },
    {
      label: 'Consent until',
      value: consent ? longDate(consent) : '—',
      warn: consentSoon,
    },
    {
      label: 'Updated',
      value: connection.lastSyncedAt ? relativeTime(connection.lastSyncedAt) : 'Never',
    },
  ];

  return (
    <>
      <ResponsiveDialogHeader className='text-start'>
        <div className='flex items-center gap-3'>
          <BankLogo
            bank={{name: connection.aspspName, logoUrl}}
            className='size-9 rounded-md text-xs shadow-none'
            imageClassName='p-1'
          />
          <ResponsiveDialogTitle className='min-w-0 truncate'>
            {connection.aspspName}
          </ResponsiveDialogTitle>
        </div>
        <ResponsiveDialogDescription className='sr-only'>
          Connection details and actions
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <ResponsiveDialogBody>
        <div className='grid grid-cols-1 gap-6 pb-4 md:pb-0'>
          <dl className='grid grid-cols-2 gap-x-4 gap-y-4'>
            {facts.map((fact) => (
              <div key={fact.label} className='min-w-0'>
                <dt className='text-label text-muted-foreground'>{fact.label}</dt>
                <dd className={cn('truncate numeric', fact.warn && 'text-warning')}>
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
          <div className='flex flex-col gap-3 md:flex-row-reverse md:justify-between'>
            {canReauthorize && (
              <Button
                variant='outline'
                disabled={isStarting}
                onClick={() => void onReauthorize(connection)}
              >
                {isStarting ? 'Starting…' : 'Re-authorize'}
              </Button>
            )}
            <Button
              variant='ghost'
              onClick={onRemove}
              className='text-destructive hover:text-destructive md:-ml-3'
            >
              Remove connection
            </Button>
          </div>
        </div>
      </ResponsiveDialogBody>
    </>
  );
}

const SYNC_IN_PROGRESS_REMOVAL =
  'Bank sync is in progress. Wait for it to finish before removing this connection.';

function RemoveStep({
  connection,
  onBack,
  onRemoved,
}: {
  connection: BankConnection;
  onBack: () => void;
  onRemoved: () => void;
}) {
  const [confirmation, setConfirmation] = useState('');
  const {deleteBankConnection, isPending: isDeleting} = useDeleteBankConnection();
  // A removal started before the dialog was closed and reopened is still this connection's.
  const isPending =
    useIsMutating({
      mutationKey: DELETE_BANK_CONNECTION_KEY,
      predicate: ({state}) =>
        (state.variables as {connectionId?: string} | undefined)?.connectionId === connection.id,
    }) > 0 || isDeleting;
  const {isPending: isRefreshing} = useBankConnectionRefreshState(connection.id);
  const destructive = (DESTRUCTIVE_CONNECTION_STATUSES as readonly string[]).includes(
    connection.status,
  );
  const blocked = isRefreshing || isSyncInProgress(connection);
  const canConfirm = (!destructive || confirmation === 'DELETE') && !isPending && !blocked;

  const remove = async () => {
    if (!canConfirm) return;
    try {
      await deleteBankConnection(connection.id, destructive ? 'DELETE' : undefined);
      toast.success('Bank connection removed', {id: `bank-connection-removed-${connection.id}`});
      onRemoved();
    } catch (error) {
      if (wasToasted(error)) return;
      toast.error('Unable to remove bank connection', {
        description: 'Please try again in a moment.',
        id: `bank-connection-remove-failed-${connection.id}`,
      });
    }
  };

  return (
    <>
      <ResponsiveDialogHeader className='text-start'>
        <ResponsiveDialogTitle>Remove {connection.aspspName}?</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className='pt-2'>
          This permanently deletes the connection, its {connection.bankAccounts.length}{' '}
          {connection.bankAccounts.length === 1 ? 'account' : 'accounts'} and all their
          transactions. This cannot be undone.
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <ResponsiveDialogBody>
        <form
          className='grid items-start gap-4'
          onSubmit={(event) => {
            event.preventDefault();
            void remove();
          }}
        >
          {destructive && (
            <div className='grid gap-2'>
              <label
                htmlFor={`remove-bank-confirmation-${connection.id}`}
                className='text-sm font-medium'
              >
                Type DELETE to confirm
              </label>
              <Input
                id={`remove-bank-confirmation-${connection.id}`}
                data-testid={`remove-bank-confirmation-${connection.id}`}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete='off'
                disabled={isPending}
              />
            </div>
          )}
          {blocked && !isPending && (
            <p role='status' className='text-sm text-muted-foreground'>
              {SYNC_IN_PROGRESS_REMOVAL}
            </p>
          )}
          <div className='mt-2 flex flex-col justify-end gap-4 pb-4 md:flex-row md:pb-0'>
            <Button
              type='submit'
              variant='destructive'
              disabled={!canConfirm}
              data-testid={`remove-bank-confirm-${connection.id}`}
              className='order-1 md:order-2'
            >
              {isPending ? <PendingLabel>Removing...</PendingLabel> : 'Remove permanently'}
            </Button>
            <Button variant='outline' type='button' onClick={onBack} className='order-2 md:order-1'>
              Back
            </Button>
          </div>
        </form>
      </ResponsiveDialogBody>
    </>
  );
}

function accountBalance(account: Account) {
  const current = account.currentBalanceAmount?.trim();
  if (current && Number.isFinite(Number(current)))
    return {amount: Number(current), currency: account.currency};
  const balances = account.latestBalances ?? [];
  const primary = balances.find((balance) => balance.isPrimary) ?? balances[0];
  if (!primary) return null;
  return {amount: Number(primary.amount), currency: primary.currency};
}

/**
 * The sum of the bank's non-zero balances: in their currency when they share one, otherwise in
 * the owner's base currency. Null with fewer than two, or when mixed currencies lack a conversion.
 */
function bankTotal(connection: BankConnection) {
  const known = connection.bankAccounts.flatMap((account) => {
    const balance = accountBalance(account);
    return balance && balance.amount !== 0
      ? [{...balance, inBase: account.currentBalanceInBaseCurrency}]
      : [];
  });
  if (known.length < 2) return null;
  const [{currency: first}] = known;
  if (known.every((balance) => balance.currency === first))
    return {amount: known.reduce((sum, balance) => sum + balance.amount, 0), currency: first};
  const base = connection.baseCurrency;
  if (!base) return null;
  let amount = 0;
  for (const balance of known) {
    if (balance.currency === base) amount += balance.amount;
    else if (balance.inBase) amount += Number(balance.inBase);
    else return null;
  }
  return {amount, currency: base};
}

/** The account's own name when it has one; provider names are often just the holder's name. */
function accountName(account: Account) {
  return (
    account.alias ||
    account.details ||
    account.name ||
    formatAccountType(account.cashAccountType) ||
    'Bank account'
  );
}

function lastDigits(account: Account) {
  const digits = account.maskedIdentifier?.replace(/[^0-9A-Za-z]/g, '').slice(-4);
  return digits ? `••${digits}` : null;
}

function AccountTypeIcon({type}: {type: string | null}) {
  const props = {className: 'size-4', strokeWidth: 1.8} as const;
  const normalized = type?.toUpperCase();
  if (normalized === 'SVGS') return <PiggyBank {...props} />;
  if (normalized === 'CARD') return <CreditCard {...props} />;
  if (normalized === 'CACC') return <Wallet {...props} />;
  return <Landmark {...props} />;
}

function formatAccountType(value: string | null) {
  if (!value) return null;
  const normalized = value.toUpperCase();
  if (normalized === 'CACC') return 'Current account';
  if (normalized === 'SVGS') return 'Savings';
  if (normalized === 'CARD') return 'Card';
  return formatBankingWords(value);
}

const regionNames = new Intl.DisplayNames(undefined, {type: 'region'});

function formatCountry(code: string) {
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Not updated for over a day. */
function isStale(connection: BankConnection) {
  return Boolean(connection.lastSyncedAt && Date.now() - Date.parse(connection.lastSyncedAt) > DAY);
}

function isWithinDays(value: string, days: number) {
  return Date.parse(value) - Date.now() < days * DAY;
}

function shortDate(value: string) {
  return format(new Date(value), 'd MMM');
}

function longDate(value: string) {
  return format(new Date(value), 'd MMM yyyy');
}

function relativeDays(value: string) {
  const days = Math.ceil((Date.parse(value) - Date.now()) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
