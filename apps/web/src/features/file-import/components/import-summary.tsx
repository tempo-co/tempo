import type {BankImportSummary} from '@tempo/contracts';
import {ArrowDownToLine, CalendarRange, CheckCheck, Undo2} from 'lucide-react';
import type {ElementType, ReactNode} from 'react';

import {StateMessage} from '@/components/shared/state-message';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {type BankLogos, bankLogoKey, useBankLogos} from '@/features/banking/api/use-bank-logos';
import {
  ACCOUNT_TILE,
  AccountTypeIcon,
  ImportedFilesTile,
} from '@/features/banking/components/account-tiles';
import {BankLogo} from '@/features/banking/components/bank-logo';
import {accountSubline} from '@/features/banking/utils/bank-account-name';
import {cn} from '@/utils/cn';

import {
  formatCount,
  formatDateRange,
  isNothingNew,
  nothingNewCopy,
  undoneDescription,
  undoneTitle,
} from '../utils/import-format';
import {ImportBalancePrompts} from './account-balance';
import {type KnownAccount, importAccountName, useKnownAccounts} from './use-known-accounts';

type Count = {label: string; value: number; attention?: boolean};

/**
 * What one import did: its counts, the dates it covered and the accounts it went to. An undone import says so first,
 * and its counts read as what it found when it ran.
 */
export function ImportSummaryBody({summary}: {summary: BankImportSummary}) {
  const known = useKnownAccounts();
  const range = formatDateRange(summary.dateFrom, summary.dateTo);
  const undoneAt = summary.undoneAt;

  return (
    <div className='grid grid-cols-1 gap-5' data-testid='bank-import-summary'>
      {undoneAt && (
        <Alert data-testid='bank-import-undone'>
          <Undo2 aria-hidden='true' />
          <AlertTitle>{undoneTitle(undoneAt)}</AlertTitle>
          <AlertDescription>
            {undoneDescription(summary, {
              intoSyncedAccount: summary.accounts.some((account) => known.get(account.id)?.synced),
            })}
          </AlertDescription>
        </Alert>
      )}
      {undoneAt ? (
        <section aria-labelledby='bank-import-counts' className='grid grid-cols-1 gap-1.5'>
          <h3 id='bank-import-counts' className='text-label text-muted-foreground'>
            When imported
          </h3>
          <Counts
            muted
            counts={[
              {label: 'Were new', value: summary.rowsAdded},
              {label: 'Were already in Tempo', value: summary.rowsAlreadyPresent},
            ]}
          />
        </section>
      ) : isNothingNew(summary) ? (
        <StateMessage size='section' icon={CheckCheck} {...nothingNewCopy(summary)} />
      ) : (
        <Counts
          counts={[
            {label: 'New transactions', value: summary.rowsAdded},
            {label: 'Already in Tempo', value: summary.rowsAlreadyPresent},
            ...(summary.rowsDoubtful > 0
              ? [{label: 'Need a look', value: summary.rowsDoubtful, attention: true}]
              : []),
          ]}
        />
      )}
      {(range || summary.accounts.length > 0) && (
        <dl className='grid grid-cols-1 gap-4'>
          {range && (
            <DetailRow icon={CalendarRange} label='Period'>
              <span className='text-sm'>{range}</span>
            </DetailRow>
          )}
          {summary.accounts.length > 0 && (
            <DetailRow icon={ArrowDownToLine} label='Went to'>
              <ImportAccounts summary={summary} known={known} />
            </DetailRow>
          )}
        </dl>
      )}
      <ImportBalancePrompts summary={summary} />
    </div>
  );
}

function Counts({counts, muted}: {counts: Count[]; muted?: boolean}) {
  return (
    <dl
      className={cn(
        'divide-y overflow-hidden rounded-card border bg-card',
        muted && 'text-muted-foreground',
      )}
    >
      {counts.map(({label, value, attention}) => (
        <div key={label} className='flex min-h-11 items-center justify-between gap-4 px-4 py-2.5'>
          <dt className='text-sm'>{label}</dt>
          <dd className={cn('numeric text-sm', attention && 'text-warning')}>
            {formatCount(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A labelled detail of the import: a small glyph and label over its value. */
function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: ElementType;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className='grid grid-cols-1 gap-1.5'>
      <dt className='flex items-center gap-1.5 text-label text-muted-foreground'>
        <Icon aria-hidden='true' className='size-3.5' strokeWidth={2} />
        {label}
      </dt>
      <dd className='min-w-0'>{children}</dd>
    </div>
  );
}

/** Each account the import went to, as its Connections card and row show it: bank logo, name and what tells it apart. */
function ImportAccounts({
  summary,
  known,
}: {
  summary: BankImportSummary;
  known: Map<string, KnownAccount>;
}) {
  const logos = useBankLogos(true);
  return (
    <ul className='grid grid-cols-1 gap-3' data-testid='bank-import-accounts'>
      {summary.accounts.map((account) => {
        const match = known.get(account.id);
        const subline = match ? accountSubline(match.account) : '';
        const detail = [
          account.created && 'New account',
          subline || account.currency,
          match && (match.synced ? match.connection.aspspName : 'Imported files'),
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <li key={account.id} className='grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3'>
            <AccountTile match={match} logos={logos} />
            <span className='min-w-0'>
              <span className='block text-sm wrap-anywhere'>
                {importAccountName(account, known)}
              </span>
              <span className='block text-xs wrap-anywhere text-muted-foreground'>{detail}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The account's bank logo (imported files: the files tile) as on its Connections card, with its type in a small
 * tile on the corner as on its Connections row. An account the loaded list lacks gets the plain account tile.
 */
function AccountTile({match, logos}: {match?: KnownAccount; logos: BankLogos}) {
  if (!match)
    return (
      <span aria-hidden='true' className={cn(ACCOUNT_TILE, 'rounded-md')}>
        <AccountTypeIcon type={null} />
      </span>
    );
  const {connection, account, synced} = match;
  return (
    <span className='relative size-9' data-testid='bank-import-account-tile'>
      {synced ? (
        <BankLogo
          bank={{
            name: connection.aspspName,
            ...logos[bankLogoKey(connection.aspspName, connection.aspspCountry)],
          }}
          className='size-9 rounded-md text-xs shadow-none'
          imageClassName='p-1'
        />
      ) : (
        <ImportedFilesTile />
      )}
      <span
        aria-hidden='true'
        className={cn(ACCOUNT_TILE, 'absolute -right-1.5 -bottom-1.5 size-5')}
      >
        <AccountTypeIcon type={account.cashAccountType} className='size-3' />
      </span>
    </span>
  );
}
