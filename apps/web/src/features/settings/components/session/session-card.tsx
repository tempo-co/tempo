import {format, formatDistanceToNowStrict} from 'date-fns';
import {createElement} from 'react';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {Session} from '@/features/settings/types/session';

import {getSessionIcon} from '../../utils/get-session-icon';
import {LogOutDialog} from './log-out-dialog';
import {SessionRevokeDialog} from './session-revoke-dialog';

type SessionCardProps = {
  session: Session;
};

/** One row of the sessions list. The action stays visible: rows must work without hover. */
export function SessionCard({session}: SessionCardProps) {
  const createdAt = format(session.createdAt, 'MMM d, yyyy HH:mm');
  const lastSeenAt = format(session.lastSeenAt, 'MMM d, yyyy HH:mm');
  const lastSeenAtRelative = formatDistanceToNowStrict(session.lastSeenAt, {addSuffix: true});

  return (
    <Dialog>
      <div
        className='flex min-h-16 items-center gap-2 pr-4'
        data-testid='session-card'
        data-current-session={session.isCurrent}
      >
        <DialogTrigger asChild>
          <button
            type='button'
            className='flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pl-4 text-left transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden focus-visible:ring-inset'
          >
            {createElement(getSessionIcon(session), {
              className: 'size-5 shrink-0 text-muted-foreground',
              'aria-hidden': true,
            })}
            <span className='min-w-0 flex-1'>
              <span className='block truncate text-sm font-medium'>{session.name}</span>
              <span className='mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground'>
                {session.isCurrent ? (
                  <span className='inline-flex items-center gap-1.5 font-medium text-success'>
                    <span aria-hidden='true' className='block size-1.5 rounded-full bg-success' />
                    This device
                  </span>
                ) : (
                  <span title={lastSeenAt}>{`Active ${lastSeenAtRelative}`}</span>
                )}
                {session.location && (
                  <>
                    <span aria-hidden='true' className='max-sm:hidden'>
                      ·
                    </span>
                    <span className='max-sm:hidden'>{session.location}</span>
                  </>
                )}
              </span>
            </span>
          </button>
        </DialogTrigger>
        {session.isCurrent ? <LogOutDialog /> : <SessionRevokeDialog session={session} />}
      </div>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='wrap-anywhere'>{session.name}</DialogTitle>
        </DialogHeader>
        <dl className='divide-y text-sm'>
          <div className='grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 py-3 capitalize'>
            <dt className='text-muted-foreground'>Device</dt>
            <dd className='text-right wrap-anywhere'>{session.deviceType}</dd>
          </div>
          <div className='grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 py-3'>
            <dt className='text-muted-foreground'>IP address</dt>
            <dd className='text-right font-mono wrap-anywhere'>{session.ip}</dd>
          </div>
          <div className='grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 py-3'>
            <dt className='text-muted-foreground'>Location</dt>
            <dd className='text-right wrap-anywhere'>{session.location}</dd>
          </div>
          <div className='grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 py-3'>
            <dt className='text-muted-foreground'>Signed in</dt>
            <dd className='text-right wrap-anywhere'>{createdAt}</dd>
          </div>
          <div className='grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 py-3'>
            <dt className='text-muted-foreground'>Last active</dt>
            <dd className='text-right wrap-anywhere'>{lastSeenAt}</dd>
          </div>
        </dl>
        <DialogFooter>
          <DialogClose asChild>
            {session.isCurrent ? (
              <LogOutDialog triggerVariant='destructive' />
            ) : (
              <SessionRevokeDialog session={session} triggerVariant='destructive' />
            )}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
