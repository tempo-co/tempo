import {format, isPast, isToday, isYesterday} from 'date-fns';
import {KeyRound, Plus} from 'lucide-react';
import {useRef, useState} from 'react';

import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';
import {cn} from '@/utils/cn';

import {usePersonalAccessTokens} from '../../api/use-personal-access-tokens';
import {PersonalAccessToken} from '../../types/personal-access-token';
import {SettingsGroup, SettingsList} from '../settings-group';
import {CreateTokenDialog} from './create-token-dialog';
import {RevokeTokenDialog} from './revoke-token-dialog';

export function AccessTokenSettings() {
  const {data: tokens, isPending, isError, refetch} = usePersonalAccessTokens();
  // The dialog lives outside the empty state, so the one-time reveal survives the list refresh.
  const [creating, setCreating] = useState(false);
  const headerCreate = useRef<HTMLButtonElement>(null);
  const emptyCreate = useRef<HTMLButtonElement>(null);
  const hasTokens = (tokens?.length ?? 0) > 0;

  return (
    <SettingsGroup
      id='access-tokens-heading'
      title='Access tokens'
      description='Access tokens let MCP clients, such as AI assistants, read your Tempo data.'
      action={
        hasTokens && (
          <Button
            ref={headerCreate}
            variant='outline'
            size='sm'
            onClick={() => setCreating(true)}
            className='max-sm:h-11'
          >
            <Plus className='size-4' aria-hidden='true' />
            Create token
          </Button>
        )
      }
    >
      {isPending && <Skeleton className='h-24 w-full rounded-card border bg-card' />}
      {isError && (
        <EmptyState
          icon={KeyRound}
          tone='error'
          title='Access tokens could not be loaded.'
          description='Check your connection and try again.'
        >
          <Button variant='outline' onClick={() => void refetch()}>
            Try again
          </Button>
        </EmptyState>
      )}
      {tokens?.length === 0 && (
        <EmptyState
          icon={KeyRound}
          title='No access tokens yet.'
          description='Create a token to connect an MCP client.'
        >
          <Button ref={emptyCreate} onClick={() => setCreating(true)} className='max-sm:h-11'>
            Create token
          </Button>
        </EmptyState>
      )}
      {hasTokens && (
        <SettingsList>
          {tokens?.map((token) => (
            <AccessTokenRow key={token.id} token={token} />
          ))}
        </SettingsList>
      )}
      <CreateTokenDialog
        open={creating}
        onOpenChange={setCreating}
        onClosed={() => (headerCreate.current ?? emptyCreate.current)?.focus()}
      />
    </SettingsGroup>
  );
}

function AccessTokenRow({token}: {token: PersonalAccessToken}) {
  return (
    <div
      data-testid='access-token-row'
      className='flex min-h-16 items-center justify-between gap-4 px-4 py-3'
    >
      <div className='min-w-0'>
        <p className='text-sm font-medium wrap-anywhere'>{token.name}</p>
        <p className='mt-0.5 font-mono text-xs wrap-anywhere text-muted-foreground'>
          {token.prefix}…
        </p>
        {/* A timeline: created, last used, expires. One line with dots on wider screens; on phones
            each part gets its own line, so nothing wraps mid-part or leaves a dangling dot. */}
        <p className='mt-0.5 text-xs text-muted-foreground'>
          <span data-testid='access-token-usage'>
            <span className='whitespace-nowrap max-sm:block'>
              Created {formatDay(token.createdAt)}
            </span>
            <Dot className='max-sm:hidden' />
            <span className='whitespace-nowrap max-sm:mt-0.5 max-sm:block'>
              {token.lastUsedAt ? `Last used ${lastUsed(token.lastUsedAt)}` : 'Never used'}
            </span>
          </span>
          <Dot className='max-sm:hidden' />
          <TokenExpiry expiresAt={token.expiresAt} />
        </p>
      </div>
      <div className='shrink-0'>
        <RevokeTokenDialog token={token} />
      </div>
    </div>
  );
}

const formatDay = (value: string) => format(new Date(value), 'd MMM yyyy');

function lastUsed(value: string) {
  const date = new Date(value);
  if (isToday(date)) return 'today';
  if (isYesterday(date)) return 'yesterday';
  return formatDay(value);
}

function Dot({className}: {className?: string}) {
  return (
    <span aria-hidden='true' className={cn('mx-1.5', className)}>
      ·
    </span>
  );
}

function TokenExpiry({expiresAt}: {expiresAt: string | null}) {
  const expired = expiresAt !== null && isPast(new Date(expiresAt));
  return (
    <span
      data-testid='access-token-expiry'
      className={cn('whitespace-nowrap max-sm:mt-0.5 max-sm:block', expired && 'text-destructive')}
    >
      {expiresAt === null
        ? 'No expiration'
        : `${expired ? 'Expired' : 'Expires'} ${formatDay(expiresAt)}`}
    </span>
  );
}
