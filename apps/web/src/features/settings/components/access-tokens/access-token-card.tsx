import type {PersonalAccessToken} from '@tempo/contracts';
import {format, isPast, isToday, isYesterday} from 'date-fns';
import {KeyRound} from 'lucide-react';
import {ReactNode} from 'react';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {cn} from '@/utils/cn';

import {RevokeTokenDialog} from './revoke-token-dialog';

export function AccessTokenCard({token}: {token: PersonalAccessToken}) {
  return (
    <Dialog>
      <div className='flex min-h-16 items-center gap-4 pr-4' data-testid='access-token-row'>
        <DialogTrigger asChild>
          <button
            type='button'
            aria-label={`View ${token.name}`}
            className='flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pl-4 text-left transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
          >
            <KeyRound
              className='size-5 shrink-0 text-muted-foreground'
              aria-hidden='true'
              data-testid='access-token-icon'
            />
            <span className='min-w-0 flex-1'>
              <span className='block truncate text-sm font-medium'>{token.name}</span>
              <span
                className='mt-0.5 block truncate text-sm text-muted-foreground'
                data-testid='access-token-usage'
              >
                {token.lastUsedAt ? `Last used ${lastUsed(token.lastUsedAt)}` : 'Never used'}
              </span>
            </span>
          </button>
        </DialogTrigger>
        <RevokeTokenDialog token={token} />
      </div>
      <DialogContent
        aria-describedby={undefined}
        className='max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md [&>button]:max-sm:top-1 [&>button]:max-sm:right-1 [&>button]:max-sm:grid [&>button]:max-sm:size-11 [&>button]:max-sm:place-items-center'
      >
        <DialogHeader className='pr-8 text-start'>
          <DialogTitle className='wrap-anywhere'>{token.name}</DialogTitle>
        </DialogHeader>
        <dl className='divide-y text-sm'>
          <TokenDetail label='Token prefix'>
            <span className='font-mono'>{token.prefix}…</span>
          </TokenDetail>
          <TokenDetail label='Permissions'>Read-only</TokenDetail>
          <TokenDetail label='Created'>{formatTimestamp(token.createdAt)}</TokenDetail>
          <TokenDetail label='Last used'>
            {token.lastUsedAt ? formatTimestamp(token.lastUsedAt) : 'Never used'}
          </TokenDetail>
          <TokenDetail label='Expiration'>
            <TokenExpiry expiresAt={token.expiresAt} />
          </TokenDetail>
        </dl>
        <DialogFooter>
          <RevokeTokenDialog token={token} triggerVariant='destructive' />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TokenDetail({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className='grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 py-3'>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='text-right wrap-anywhere'>{children}</dd>
    </div>
  );
}

const formatTimestamp = (value: string) => format(new Date(value), 'd MMM yyyy, HH:mm');

function lastUsed(value: string) {
  const date = new Date(value);
  if (isToday(date)) return 'today';
  if (isYesterday(date)) return 'yesterday';
  return format(date, 'd MMM yyyy');
}

function TokenExpiry({expiresAt}: {expiresAt: string | null}) {
  const expired = expiresAt !== null && isPast(new Date(expiresAt));
  return (
    <span data-testid='access-token-expiry' className={cn(expired && 'text-destructive')}>
      {expiresAt === null
        ? 'No expiration'
        : `${expired ? 'Expired ' : ''}${formatTimestamp(expiresAt)}`}
    </span>
  );
}
