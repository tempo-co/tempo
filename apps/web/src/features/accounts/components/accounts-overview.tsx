import {Link} from '@tanstack/react-router';
import type {BankAccount, BankConnection, BankImportSummary} from '@tempo/contracts';
import {ChevronRight, Eye, Landmark, Trash2} from 'lucide-react';
import {type MouseEvent, type ReactNode, useState} from 'react';
import {toast} from 'sonner';

import {PendingLabel} from '@/components/shared/pending-label';
import {LoadErrorState, StateMessage} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {type BankLogos, bankLogoKey, useBankLogos} from '@/features/banking/api/use-bank-logos';
import {accountName} from '@/features/banking/utils/bank-account-name';
import {isFileConnection} from '@/features/banking/utils/bank-sync-status';
import {Bone, TextBone, TileRowsSkeleton} from '@/features/dashboard/components/loading';
import {wasToasted} from '@/utils/api';
import {cn} from '@/utils/cn';
import {formatCurrency} from '@/utils/format-currency';

import {useUpdateBankAccount} from '../api/use-bank-account-settings';
import {useConnectBank} from '../api/use-connect-bank';
import {accountFreshness, connectionProblem} from '../utils/account-freshness';
import {
  type AccountEntry,
  type Money,
  accountBalance,
  groupAccounts,
} from '../utils/account-groups';
import {accountSource, headlineFigure} from '../utils/account-labels';
import {AccountTile, FreshnessLine} from './account-parts';
import {RemoveConnectionDialog} from './remove-connection-dialog';

/** The shared 60px row's grid, with a trailing chevron on wider screens; it grows for a wrapped freshness line. */
const ROW =
  'relative grid min-h-15 w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] max-sm:grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left hover:bg-accent/50 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-ring';

/**
 * The Accounts tab: the total across every shown account, then the accounts grouped by type. Each row names its bank
 * and how its data arrives, says how current it is, and opens the account's page. A bank connection that holds no
 * account is listed on its own, to reconnect or remove. Hidden accounts come last, under Hidden, to show again.
 */
export function AccountsOverview({
  connections,
  isPending,
  isError,
  error,
  onRetry,
  imports,
  onImport,
  balanceAction,
  emptyActions,
  now,
}: {
  connections: BankConnection[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => unknown;
  /** The import list once it answers; undefined while file import is off or unknown. */
  imports?: BankImportSummary[];
  /** Starts an import; absent while file import is off. */
  onImport?: (event: MouseEvent<HTMLElement>) => void;
  /** An imported-files account's Add balance or Edit; absent while file import is off. */
  balanceAction?: (account: BankAccount) => ReactNode;
  /** The empty page's ways to add data. */
  emptyActions: ReactNode;
  now: number;
}) {
  const bankLogos = useBankLogos(!isPending && !isError);
  const {reconnect, isStarting} = useConnectBank();

  if (isPending)
    return (
      <div role='status' aria-label='Loading accounts' className='grid grid-cols-1 gap-3'>
        <Card aria-hidden='true' className='p-4'>
          <p className='text-body-small'>
            <TextBone className='w-[8em]' />
          </p>
          <Bone className='mt-1 h-9 w-[7em]' />
        </Card>
        <Card aria-hidden='true' className='p-4'>
          <p className='text-card-title'>
            <TextBone className='w-[4em]' />
          </p>
          <ul className='-mx-3 mt-2 grid grid-cols-1'>
            <TileRowsSkeleton count={2} />
          </ul>
        </Card>
      </div>
    );
  if (isError)
    return <LoadErrorState title="Couldn't load accounts" error={error} onRetry={onRetry} />;

  const {groups, total, unlinked, hidden} = groupAccounts(connections, now);
  if (groups.length === 0 && unlinked.length === 0 && hidden.length === 0)
    return (
      <StateMessage
        icon={Landmark}
        title='No accounts yet'
        description={
          onImport
            ? 'Connect a bank to keep its accounts up to date, or import statement files.'
            : 'Connect a bank to bring its accounts in.'
        }
      >
        {emptyActions}
      </StateMessage>
    );

  const row = (entry: AccountEntry) => (
    <li key={entry.account.id}>
      <AccountRow
        entry={entry}
        bankLogos={bankLogos}
        imports={imports}
        onImport={onImport}
        onReconnect={() => void reconnect(entry.connection)}
        isStarting={isStarting}
        balanceAction={isFileConnection(entry.connection) ? balanceAction : undefined}
        now={now}
      />
    </li>
  );

  return (
    <div className='grid grid-cols-1 gap-3' data-testid='accounts-overview'>
      {unlinked.length > 0 && (
        <UnlinkedConnections
          connections={unlinked}
          bankLogos={bankLogos}
          onReconnect={(connection) => void reconnect(connection)}
          isStarting={isStarting}
          now={now}
        />
      )}
      {total && groups.length > 0 && (
        <Card className='p-4' data-testid='accounts-total'>
          <p className='text-body-small text-muted-foreground'>Across all accounts</p>
          <p className={headlineFigure(money(total))}>{money(total)}</p>
          {groups.length > 1 && (
            <p className='mt-1 flex flex-wrap gap-x-4 text-body-small text-muted-foreground'>
              {groups.map((group) => (
                <span key={group.type}>
                  {group.label}{' '}
                  <span className='numeric font-medium text-foreground'>
                    {group.total ? money(group.total) : '—'}
                  </span>
                </span>
              ))}
            </p>
          )}
        </Card>
      )}
      {groups.map((group) => (
        <Card
          key={group.type}
          role='region'
          aria-labelledby={`accounts-${group.type}-heading`}
          data-testid={`accounts-group-${group.type}`}
          className='p-4 pb-2'
        >
          <header className='flex items-baseline justify-between gap-3'>
            <h2 id={`accounts-${group.type}-heading`} className='text-card-title'>
              {group.label}
            </h2>
            {/* A group's total says something new only beside another group and over more than one account. */}
            {group.total && groups.length > 1 && group.accounts.length > 1 && (
              <span className='numeric text-body-small text-muted-foreground'>
                {money(group.total)}
              </span>
            )}
          </header>
          <ul className='-mx-3 mt-2 grid grid-cols-1 divide-y divide-border/60'>
            {group.accounts.map(row)}
          </ul>
        </Card>
      ))}
      {hidden.length > 0 && <HiddenAccounts entries={hidden} bankLogos={bankLogos} />}
    </div>
  );
}

/** Accounts the owner hid: in no list or total elsewhere, each with its balance and Show. */
function HiddenAccounts({entries, bankLogos}: {entries: AccountEntry[]; bankLogos: BankLogos}) {
  const {updateBankAccount, isPending, variables} = useUpdateBankAccount();
  const show = async ({account, connection}: AccountEntry) => {
    try {
      await updateBankAccount({
        connectionId: connection.id,
        accountId: account.id,
        isHidden: false,
      });
    } catch (error) {
      if (wasToasted(error)) return;
      toast.error(`Couldn't show ${accountName(account)}. Try again.`, {
        id: `account-show-failed-${account.id}`,
      });
    }
  };

  return (
    <Card
      role='region'
      aria-labelledby='accounts-hidden-heading'
      data-testid='accounts-hidden'
      className='p-4 pb-2'
    >
      <h2 id='accounts-hidden-heading' className='text-card-title'>
        Hidden
      </h2>
      <ul className='-mx-3 mt-2 grid grid-cols-1 divide-y divide-border/60'>
        {entries.map((entry) => {
          const {account, connection} = entry;
          const name = accountName(account);
          const balance = accountBalance(account);
          const showing = isPending && variables?.accountId === account.id;
          return (
            <li
              key={account.id}
              data-testid={`account-row-${account.id}`}
              className={cn(
                ROW,
                'grid-cols-[auto_minmax(0,1fr)_auto] max-sm:grid-cols-[auto_minmax(0,1fr)]',
              )}
            >
              <AccountTile
                connection={connection}
                artwork={bankLogos[bankLogoKey(connection.aspspName, connection.aspspCountry)]}
                className='max-sm:row-span-2'
              />
              <span className='min-w-0'>
                <Link
                  to='/accounts/$accountId'
                  params={{accountId: account.id}}
                  className='block truncate text-body text-muted-foreground outline-none after:absolute after:inset-0'
                >
                  {name}
                </Link>
                <span className='block truncate text-body-small text-muted-foreground'>
                  {accountSource(account, connection)}
                </span>
              </span>
              {/* On phones the balance and Show take the line under the name, Show wrapping under a long balance. */}
              <span className='flex flex-wrap items-center justify-end gap-x-3 gap-y-1 max-sm:col-start-2 max-sm:justify-between'>
                <span className='numeric text-body whitespace-nowrap text-muted-foreground'>
                  {balance ? money(balance) : null}
                </span>
                <Button
                  variant='outline'
                  size='sm'
                  aria-label={`Show ${name}`}
                  disabled={showing}
                  onClick={() => void show(entry)}
                  className='relative'
                >
                  {showing ? (
                    <PendingLabel>Showing…</PendingLabel>
                  ) : (
                    <>
                      <Eye aria-hidden='true' />
                      Show
                    </>
                  )}
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function AccountRow({
  entry: {account, connection},
  bankLogos,
  imports,
  onImport,
  onReconnect,
  isStarting,
  balanceAction,
  now,
}: {
  entry: AccountEntry;
  bankLogos: BankLogos;
  imports?: BankImportSummary[];
  onImport?: (event: MouseEvent<HTMLElement>) => void;
  onReconnect: () => void;
  isStarting: boolean;
  balanceAction?: (account: BankAccount) => ReactNode;
  now: number;
}) {
  const name = accountName(account);
  const balance = accountBalance(account);
  const converted =
    balance &&
    balance.amount !== 0 &&
    connection.baseCurrency &&
    account.currency !== connection.baseCurrency &&
    account.currentBalanceInBaseCurrency
      ? formatCurrency(Number(account.currentBalanceInBaseCurrency), connection.baseCurrency)
      : null;
  const freshness = accountFreshness({connection, accountId: account.id, imports, now});

  return (
    // A button cannot sit inside the link, so the link stretches over the row and the actions sit above it. The
    // freshness line takes the second row: under the name on wider screens, and under the name and amount on phones,
    // so a long amount never squeezes it.
    <div className={cn(ROW, 'gap-y-0')} data-testid={`account-row-${account.id}`}>
      <AccountTile
        connection={connection}
        artwork={bankLogos[bankLogoKey(connection.aspspName, connection.aspspCountry)]}
        className='row-span-2'
      />
      <span className='min-w-0'>
        <Link
          to='/accounts/$accountId'
          params={{accountId: account.id}}
          className='block truncate text-body outline-none after:absolute after:inset-0'
        >
          {name}
        </Link>
        <span className='block truncate text-body-small text-muted-foreground'>
          {accountSource(account, connection)}
        </span>
      </span>
      <span className='flex flex-col items-end text-right sm:row-span-2'>
        {balance && (
          <span className='block numeric text-body whitespace-nowrap'>{money(balance)}</span>
        )}
        {converted && (
          <span className='block numeric text-body-small whitespace-nowrap text-muted-foreground'>
            ≈ {converted}
          </span>
        )}
        {balanceAction && <span className='relative'>{balanceAction(account)}</span>}
      </span>
      <ChevronRight aria-hidden='true' className='size-4 text-faint max-sm:hidden sm:row-span-2' />
      <FreshnessLine
        freshness={freshness}
        onImport={onImport}
        onReconnect={onReconnect}
        names={{account: name, bank: connection.aspspName}}
        isStarting={isStarting}
        className='col-start-2 max-sm:col-span-2'
      />
    </div>
  );
}

/** Bank connections that hold no account: only what is wrong, if anything, its Reconnect, and Remove. */
function UnlinkedConnections({
  connections,
  bankLogos,
  onReconnect,
  isStarting,
  now,
}: {
  connections: BankConnection[];
  bankLogos: BankLogos;
  onReconnect: (connection: BankConnection) => void;
  isStarting: boolean;
  now: number;
}) {
  const [removing, setRemoving] = useState<{connection: BankConnection; open: boolean} | null>(
    null,
  );
  return (
    <Card
      role='region'
      aria-labelledby='accounts-unlinked-heading'
      data-testid='accounts-unlinked'
      className='p-4 pb-2'
    >
      <h2 id='accounts-unlinked-heading' className='text-card-title'>
        Banks without accounts
      </h2>
      <ul className='-mx-3 mt-2 grid grid-cols-1 divide-y divide-border/60'>
        {connections.map((connection) => {
          const problem = connectionProblem(connection, now);
          return (
            <li
              key={connection.id}
              data-testid={`unlinked-connection-${connection.id}`}
              className={cn(ROW, 'grid-cols-[auto_minmax(0,1fr)_auto] hover:bg-transparent')}
            >
              <AccountTile
                connection={connection}
                artwork={bankLogos[bankLogoKey(connection.aspspName, connection.aspspCountry)]}
              />
              <span className='min-w-0'>
                <span className='block truncate text-body'>{connection.aspspName}</span>
                <FreshnessLine
                  freshness={problem ?? {tone: 'quiet', label: 'No accounts shared', action: null}}
                  onReconnect={() => onReconnect(connection)}
                  names={{account: connection.aspspName, bank: connection.aspspName}}
                  isStarting={isStarting}
                />
              </span>
              <Button
                variant='ghost'
                size='icon'
                aria-label={`Remove ${connection.aspspName}`}
                onClick={() => setRemoving({connection, open: true})}
                className='text-destructive hover:text-destructive'
              >
                <Trash2 aria-hidden='true' />
              </Button>
            </li>
          );
        })}
      </ul>
      {removing && (
        <RemoveConnectionDialog
          connection={removing.connection}
          open={removing.open}
          onOpenChange={(open) => setRemoving((current) => current && {...current, open})}
          onRemoved={() => setRemoving((current) => current && {...current, open: false})}
        />
      )}
    </Card>
  );
}

function money(value: Money) {
  return formatCurrency(value.amount, value.currency);
}
