import {useMemo} from 'react';

import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';

import {useGetSessions} from '../../api/use-get-sessions';
import {SessionCard} from './session-card';
import {SessionRevokeAllDialog} from './session-revoke-all-dialog';

export function SessionList() {
  const {sessions, isError, isPending, refetch} = useGetSessions();

  const {currentSession, otherSessions} = useMemo(() => {
    const currentSession = sessions?.find((s) => s.isCurrent);
    const otherSessions = sessions?.filter((s) => !s.isCurrent);
    return {currentSession, otherSessions};
  }, [sessions]);

  return (
    <section aria-labelledby='active-sessions-heading' className='space-y-4'>
      <div className='space-y-1'>
        <h2 id='active-sessions-heading' className='text-lg font-semibold'>
          Active sessions
        </h2>
        <p className='max-w-[34rem] text-sm text-muted-foreground'>
          The devices currently logged into your account.
        </p>
      </div>
      {isError && sessions === undefined ? (
        <div className='flex flex-col gap-3 rounded-card border border-destructive/50 bg-destructive/10 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5'>
          <div>
            <p className='text-sm font-medium'>Sessions could not be loaded.</p>
            <p className='mt-1 text-xs text-muted-foreground'>
              Check your connection and try again.
            </p>
          </div>
          <Button
            variant='outline'
            size='sm'
            className='min-h-11 sm:min-h-9'
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </div>
      ) : (
        <div className='space-y-4'>
          {isError && sessions !== undefined && (
            <div
              role='status'
              className='flex flex-col gap-3 rounded-card border border-destructive/50 bg-destructive/10 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5'
            >
              <div>
                <p className='text-sm font-medium'>Sessions could not be refreshed.</p>
                <p className='mt-1 text-xs text-muted-foreground'>
                  Showing the last loaded list. Try again to refresh it.
                </p>
              </div>
              <Button
                variant='outline'
                size='sm'
                className='min-h-11 sm:min-h-9'
                onClick={() => void refetch()}
              >
                Try again
              </Button>
            </div>
          )}
          {isPending && <Skeleton className='h-[4.5rem] w-full rounded-lg border bg-background' />}
          {currentSession && <SessionCard key={currentSession.id} session={currentSession} />}
          {otherSessions && otherSessions.length > 0 && (
            <div>
              <div className='mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                <h3 className='text-sm font-medium text-foreground'>
                  {otherSessions.length === 1
                    ? '1 other active session'
                    : `${otherSessions.length} other active sessions`}
                </h3>
                <SessionRevokeAllDialog />
              </div>
              <div className='space-y-3'>
                {otherSessions.map((session) => (
                  <SessionCard key={session.id} session={session} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
