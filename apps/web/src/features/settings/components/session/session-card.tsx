import {format, formatDistanceToNow} from 'date-fns';

import {Card} from '@/components/ui/card';
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
  const createdAt = format(session.lastSeenAt, 'MMM d, yyyy HH:mm');
  const lastSeenAt = format(session.lastSeenAt, 'MMM d, yyyy HH:mm');
  const lastSeenAtRelative = formatDistanceToNow(lastSeenAt, {addSuffix: true});

  const Icon = getSessionIcon(session);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Card
          className='group cursor-pointer transition-colors hover:bg-accent/70'
          data-testid='session-card'
          data-current-session={session.isCurrent}
        >
          <div className='flex flex-row items-center justify-between gap-2 p-4 sm:items-center'>
            <div className='flex min-w-0 flex-grow items-center gap-2'>
              <div className='flex-shrink-0 rounded-lg bg-accent p-2 text-muted-foreground'>
                <Icon className='h-5 w-5 text-muted-foreground' />
              </div>
              <div className='min-w-0 flex-grow'>
                <p className='truncate text-sm font-medium'>{session.name}</p>
                <div className='text-xs text-muted-foreground'>
                  {session.isCurrent ? (
                    <div className='mt-1 flex gap-1.5'>
                      <div className='flex items-center gap-1.5'>
                        <span className='block h-2 w-2 rounded-full bg-success'></span>
                        <span className='font-medium text-success'>Current session</span>
                      </div>
                      <span className='invisible sm:visible'>·</span>
                      <span className='invisible sm:visible'>{session.location}</span>
                    </div>
                  ) : (
                    <div className='mt-1 flex gap-1.5' title={lastSeenAt}>
                      <span>{`Last seen ${lastSeenAtRelative}`}</span>{' '}
                      <span className='invisible sm:visible'>·</span>{' '}
                      <span className='invisible sm:visible'>{session.location}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div
              className='invisible flex-shrink-0 opacity-0 transition-opacity duration-150 ease-in-out group-hover:visible group-hover:opacity-100'
              onClick={(e) => e.stopPropagation()}
            >
              {session.isCurrent && <LogOutDialog />}
              {!(hideRevokeButton || session.isCurrent) && (
                <SessionRevokeDialog session={session} />
              )}
            </div>
          </div>
        </Card>
      </DialogTrigger>
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
