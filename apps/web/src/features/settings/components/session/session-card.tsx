import {format, formatDistanceToNow} from 'date-fns';
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
  hideRevokeButton?: boolean;
};

export function SessionCard({session, hideRevokeButton = false}: SessionCardProps) {
  const createdAt = format(session.createdAt, 'MMM d, yyyy HH:mm');
  const lastSeenAt = format(session.lastSeenAt, 'MMM d, yyyy HH:mm');
  const lastSeenAtRelative = formatDistanceToNow(session.lastSeenAt, {addSuffix: true});
  const hasAction = session.isCurrent || !hideRevokeButton;

  return (
    <Dialog>
      <div
        className='group relative rounded-card border bg-card text-card-foreground shadow-sm'
        data-testid='session-card'
        data-current-session={session.isCurrent}
      >
        <DialogTrigger asChild>
          <button
            type='button'
            className={`flex min-h-[4.5rem] w-full items-center rounded-card p-4 text-left transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${hasAction ? 'pr-24' : ''}`}
          >
            <span className='flex min-w-0 flex-1 items-center gap-3'>
              <span className='flex-shrink-0 rounded-lg bg-accent p-2 text-muted-foreground'>
                {createElement(getSessionIcon(session), {
                  className: 'h-5 w-5 text-muted-foreground',
                })}
              </span>
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-sm font-medium'>{session.name}</span>
                <span className='block text-xs text-muted-foreground'>
                  {session.isCurrent ? (
                    <span className='mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1'>
                      <span className='inline-flex items-center gap-1.5 font-medium text-success'>
                        <span
                          aria-hidden='true'
                          className='block h-2 w-2 rounded-full bg-success'
                        ></span>
                        Current session
                      </span>
                      <span className='hidden sm:inline'>·</span>
                      <span className='hidden sm:inline'>{session.location}</span>
                    </span>
                  ) : (
                    <span
                      className='mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1'
                      title={lastSeenAt}
                    >
                      <span>{`Last seen ${lastSeenAtRelative}`}</span>
                      <span className='hidden sm:inline'>·</span>
                      <span className='hidden sm:inline'>{session.location}</span>
                    </span>
                  )}
                </span>
              </span>
            </span>
          </button>
        </DialogTrigger>
        {hasAction && (
          <div className='absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 sm:invisible sm:opacity-0 sm:transition-opacity sm:duration-150 sm:ease-in-out sm:group-hover:visible sm:group-hover:opacity-100'>
            {session.isCurrent && <LogOutDialog />}
            {!(hideRevokeButton || session.isCurrent) && <SessionRevokeDialog session={session} />}
          </div>
        )}
      </div>
      <DialogContent className='sm:max-w-[28rem]'>
        <DialogHeader>
          <DialogTitle>{session.name}</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-4 text-sm'>
          <div className='flex items-center justify-between border-b border-border/50 pb-4 capitalize'>
            <span className='text-muted-foreground'>Device</span>
            <span>{session.deviceType}</span>
          </div>
          <div className='flex items-center justify-between border-b border-border/50 pb-4'>
            <span className='text-muted-foreground'>IP Address</span>
            <span className='font-mono'>{session.ip}</span>
          </div>
          <div className='flex items-center justify-between border-b border-border/50 pb-4'>
            <span className='text-muted-foreground'>Location</span>
            <span>{session.location}</span>
          </div>
          <div className='flex items-center justify-between pb-4'>
            <span className='text-muted-foreground'>Signed in at</span>
            <span>{createdAt}</span>
          </div>
        </div>
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
