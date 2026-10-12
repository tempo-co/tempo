import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';

import {useGetSessions} from '../../api/use-get-sessions';
import {SettingsGroup, SettingsList, SettingsRow} from '../settings-group';
import {SessionCard} from './session-card';
import {SessionRevokeAllDialog} from './session-revoke-all-dialog';

export function SessionList() {
  const {sessions, isError, isPending, refetch} = useGetSessions();

  const currentSession = sessions?.find((s) => s.isCurrent);
  const otherSessions = sessions?.filter((s) => !s.isCurrent) ?? [];

  return (
    <SettingsGroup
      id='active-sessions-heading'
      title='Active sessions'
      description='Devices signed in to your account.'
    >
      {isError && sessions === undefined ? (
        <SessionsErrorBanner
          title='Sessions could not be loaded.'
          description='Check your connection and try again.'
          onRetry={() => void refetch()}
        />
      ) : (
        <div className='space-y-3'>
          {isError && sessions !== undefined && (
            <SessionsErrorBanner
              role='status'
              title='Sessions could not be refreshed.'
              description='Showing the last loaded list. Try again to refresh it.'
              onRetry={() => void refetch()}
            />
          )}
          {isPending && <Skeleton className='h-16 w-full rounded-card border bg-card' />}
          {sessions && sessions.length > 0 && (
            <SettingsList>
              {currentSession && <SessionCard key={currentSession.id} session={currentSession} />}
              {otherSessions.map((session) => (
                <SessionCard key={session.id} session={session} />
              ))}
              {otherSessions.length > 0 && (
                <SettingsRow
                  label={
                    <span className='font-normal text-muted-foreground'>
                      {otherSessions.length === 1
                        ? '1 other session'
                        : `${otherSessions.length} other sessions`}
                    </span>
                  }
                  action={<SessionRevokeAllDialog />}
                />
              )}
            </SettingsList>
          )}
        </div>
      )}
    </SettingsGroup>
  );
}

type SessionsErrorBannerProps = {
  title: string;
  description: string;
  role?: 'status';
  onRetry: () => void;
};

function SessionsErrorBanner({title, description, role, onRetry}: SessionsErrorBannerProps) {
  return (
    <div
      role={role}
      className='flex flex-col gap-3 rounded-card border border-destructive/50 bg-destructive/10 p-4 sm:flex-row sm:items-center sm:justify-between'
    >
      <div>
        <p className='text-sm font-medium'>{title}</p>
        <p className='mt-1 text-xs text-muted-foreground'>{description}</p>
      </div>
      <Button variant='outline' size='sm' className='max-sm:h-11' onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
