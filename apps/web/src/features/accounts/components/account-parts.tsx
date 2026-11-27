import type {BankConnection} from '@tempo/contracts';
import {RefreshCw} from 'lucide-react';
import type {MouseEvent} from 'react';

import {TextAction} from '@/components/shared/text-action';
import {Button} from '@/components/ui/button';
import {ImportedFilesTile} from '@/features/banking/components/account-tiles';
import {type BankArtwork, BankLogo} from '@/features/banking/components/bank-logo';
import {isFileConnection} from '@/features/banking/utils/bank-sync-status';
import {cn} from '@/utils/cn';

import type {AccountFreshness} from '../utils/account-freshness';

/** The account's leading tile: its bank's logo, or for imported files the files glyph in the same square. */
export function AccountTile({
  connection,
  artwork,
  className,
}: {
  connection: BankConnection;
  artwork?: BankArtwork;
  className?: string;
}) {
  if (isFileConnection(connection))
    return <ImportedFilesTile testId='account-bank-logo' className={className} />;
  return (
    <BankLogo
      bank={{name: connection.aspspName, ...artwork}}
      className={cn('size-9 rounded-md text-body-small shadow-none', className)}
      imageClassName='p-1'
      testId='account-bank-logo'
    />
  );
}

const DOT = {ok: 'bg-success', warning: 'bg-warning', quiet: 'bg-faint'} as const;

/**
 * The freshness line: a status dot, what it says and its one action. The dot repeats the tone; the words carry it.
 * `onImport` is absent where import is off, and the line then offers nothing to import. In a list, `names` puts the
 * account and its bank into the actions' accessible names, so each row's action can be told apart.
 */
export function FreshnessLine({
  freshness,
  onReconnect,
  onImport,
  isStarting,
  names,
  className,
}: {
  freshness: AccountFreshness;
  onReconnect?: () => void;
  onImport?: (event: MouseEvent<HTMLElement>) => void;
  isStarting?: boolean;
  names?: {account: string; bank: string};
  className?: string;
}) {
  const {tone, label, detail, action} = freshness;
  return (
    <span
      data-testid='account-freshness'
      data-tone={tone}
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-1.5 text-body-small text-muted-foreground',
        className,
      )}
    >
      <span className={cn('min-w-0', tone === 'warning' && 'text-warning')}>
        {/* Inline, so a wrapped line keeps its dot beside the first word. */}
        <span
          aria-hidden='true'
          className={cn('mr-1.5 inline-block size-1.5 rounded-full align-middle', DOT[tone])}
        />
        {label}
        {detail && <span className='text-muted-foreground'> · {detail}</span>}
      </span>
      {action === 'import' && onImport && (
        <TextAction
          onClick={onImport}
          aria-label={
            names && `${tone === 'warning' ? 'Import newer' : 'Import a file'} for ${names.account}`
          }
          className='relative -my-1 h-auto px-1 py-0.5 text-body-small max-sm:min-h-11 pointer-coarse:min-h-11'
        >
          {tone === 'warning' ? 'Import newer' : 'Import a file'}
        </TextAction>
      )}
      {action === 'reconnect' && onReconnect && (
        <Button
          variant='outline'
          size='sm'
          disabled={isStarting}
          onClick={onReconnect}
          aria-label={names && !isStarting ? `Reconnect ${names.bank}` : undefined}
          className='relative my-1 basis-auto'
        >
          <RefreshCw aria-hidden='true' />
          {isStarting ? 'Starting…' : 'Reconnect'}
        </Button>
      )}
    </span>
  );
}
