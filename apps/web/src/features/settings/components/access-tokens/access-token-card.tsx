import type {PersonalAccessToken} from '@tempo/contracts';
import {format, isPast, isToday, isYesterday} from 'date-fns';
import {KeyRound} from 'lucide-react';
import {ReactNode} from 'react';

import {Button} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';
import {cn} from '@/utils/cn';

import {RevokeTokenDialog} from './revoke-token-dialog';

export function AccessTokenCard({token}: {token: PersonalAccessToken}) {
  return (
    <ResponsiveDialog>
      <div className='flex min-h-16 items-center gap-4 pr-4' data-testid='access-token-row'>
        <ResponsiveDialogTrigger asChild>
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
        </ResponsiveDialogTrigger>
        <RevokeTokenDialog token={token} />
      </div>
      <ResponsiveDialogContent aria-describedby={undefined} className='md:max-w-md'>
        <ResponsiveDialogHeader className='pr-8 text-start'>
          <ResponsiveDialogTitle className='wrap-anywhere'>{token.name}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
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
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <RevokeTokenDialog token={token} triggerVariant='destructive' />
          <ResponsiveDialogClose asChild className='md:hidden'>
            <Button variant='outline'>Close</Button>
          </ResponsiveDialogClose>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
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
