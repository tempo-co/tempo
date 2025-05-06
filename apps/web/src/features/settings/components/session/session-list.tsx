import {useMemo} from 'react';

import {Skeleton} from '@/components/ui/skeleton';

import {useGetSessions} from '../../api/use-get-sessions';
import {SessionCard} from './session-card';
import {SessionRevokeAllDialog} from './session-revoke-all-dialog';

export function SessionList() {
  const {sessions, isPending} = useGetSessions();

  const {currentSession, otherSessions} = useMemo(() => {
    const currentSession = sessions?.find((s) => s.isCurrent);
    const otherSessions = sessions?.filter((s) => !s.isCurrent);
    return {currentSession, otherSessions};
  }, [sessions]);

  return (
    <div>
      <div className='mb-4'>
        <h2 className='mb-1 text-lg font-semibold'>Active Sessions</h2>
        <p className='mr-8 text-sm text-muted-foreground'>
          The devices currently logged into your account.
        </p>
      </div>
      <div className='mt-4 space-y-4'>
        {isPending && <Skeleton className='h-[4.5rem] w-full rounded-lg border bg-background' />}
        {currentSession && (
          <div>
            <SessionCard key={currentSession.id} session={currentSession} />
          </div>
        )}
        {otherSessions && otherSessions.length > 0 && (
          <div className='mt-6'>
            <div className='mb-3 flex items-center justify-between'>
              <h3 className='text-sm font-medium text-muted-foreground'>
                {otherSessions.length === 1
                  ? '1 other active session'
                  : `${otherSessions.length} other active sessions`}
              </h3>
              <SessionRevokeAllDialog />
            </div>
            <div className='space-y-4'>
              {otherSessions.map((session) => (
                <SessionCard key={session.id} session={session} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
