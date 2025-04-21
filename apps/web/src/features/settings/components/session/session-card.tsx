import {format} from 'date-fns';
import {Monitor} from 'lucide-react';

import {Badge} from '@/components/ui/badge';
import {Card} from '@/components/ui/card';
import {Session} from '@/features/settings/types/session';

import {SessionRevokeDialog} from './session-revoke-dialog';

type SessionCardProps = {
  session: Session;
  hideRevokeButton?: boolean;
};

export function SessionCard({session, hideRevokeButton = false}: SessionCardProps) {
  const showRevokeButton = !(hideRevokeButton || session.isCurrent);

  return (
    <Card className='bg-sidebar'>
      <div className='flex flex-col items-start justify-between gap-4 p-4 sm:flex-row sm:items-center'>
        <div className='flex min-w-0 flex-grow items-center gap-4'>
          <div className='flex-shrink-0 text-muted-foreground'>
            <Monitor className='h-6 w-6 sm:h-8 sm:w-8' />
          </div>
          <div className='min-w-0 flex-grow'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='truncate text-sm font-medium sm:text-base' title={session.ip}>
                {session.ip}
              </span>
              {session.isCurrent && (
                <Badge variant='secondary' className='text-xs'>
                  Current session
                </Badge>
              )}
            </div>
            <p
              className='mt-1 truncate text-xs text-muted-foreground sm:text-sm'
              title={session.userAgent}
            >
              {session.clientDescription}
            </p>
            <p className='text-xs text-muted-foreground'>
              Last seen {format(session.lastSeen, 'MMM d, yyyy HH:mm')}
            </p>
          </div>
        </div>
        {showRevokeButton && <SessionRevokeDialog session={session} />}
      </div>
    </Card>
  );
}
