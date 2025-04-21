import {format} from 'date-fns';
import {Monitor, Smartphone, Tablet, TvMinimal} from 'lucide-react';

import {Badge} from '@/components/ui/badge';
import {Card} from '@/components/ui/card';
import {Session} from '@/features/settings/types/session';

import {SessionRevokeDialog} from './session-revoke-dialog';

type SessionCardProps = {
  session: Session;
  hideRevokeButton?: boolean;
  forceStackedLayout?: boolean;
};

export function SessionCard({
  session,
  hideRevokeButton = false,
  forceStackedLayout = false,
}: SessionCardProps) {
  const showRevokeButton = !(hideRevokeButton || session.isCurrent);
  const createdAt = format(session.createdAt, 'MMM d, yyyy HH:mm');
  const lastSeenAt = format(session.lastSeenAt, 'MMM d, yyyy HH:mm');
  const location = session.clientLocation !== 'Unknown' ? ` in ${session.clientLocation}` : '';

  const loggedInString = `Logged in ${createdAt}${location}`;
  const lastSeenString = `Last seen ${lastSeenAt}`;

  const getDeviceIcon = (deviceType: string) => {
    switch (deviceType) {
      case 'mobile':
        return <Smartphone className='h-6 w-6 sm:h-8 sm:w-8' />;
      case 'tablet':
        return <Tablet className='h-6 w-6 sm:h-8 sm:w-8' />;
      case 'console':
      case 'smarttv':
      case 'wearable':
      case 'xr':
      case 'embedded':
        return <TvMinimal className='h-6 w-6 sm:h-8 sm:w-8' />;
      case 'desktop':
      default:
        return <Monitor className='h-6 w-6 sm:h-8 sm:w-8' />;
    }
  };

  return (
    <Card className='bg-sidebar'>
      <div className='flex flex-col items-start justify-between gap-4 p-4 sm:flex-row sm:items-center'>
        <div className='flex min-w-0 flex-grow items-center gap-4'>
          <div className='flex-shrink-0 text-muted-foreground'>
            {getDeviceIcon(session.deviceType)}
          </div>
          <div className='min-w-0 flex-grow'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='truncate font-medium' title={session.ip}>
                {session.ip}
              </span>
              {session.isCurrent && (
                <Badge variant='secondary' className='text-xs'>
                  Current session
                </Badge>
              )}
            </div>

            <p className='mt-1 truncate text-sm text-muted-foreground' title={session.userAgent}>
              {session.clientDescription}
            </p>
            {forceStackedLayout ? (
              <div className='mt-1 text-xs text-muted-foreground'>
                <span className='block break-words' title={loggedInString}>
                  {loggedInString}
                </span>
                <span className='block' title={lastSeenString}>
                  {lastSeenString}
                </span>
              </div>
            ) : (
              <div className='mt-1 text-xs text-muted-foreground md:gap-2 xl:flex xl:items-baseline'>
                <span className='block break-words xl:inline-block' title={loggedInString}>
                  {loggedInString}
                </span>
                <span className='hidden xl:inline-block' aria-hidden='true'>
                  •
                </span>
                <span
                  className='mt-1 block truncate xl:mt-0 xl:inline-block'
                  title={lastSeenString}
                >
                  {lastSeenString}
                </span>
              </div>
            )}
          </div>
        </div>
        {showRevokeButton && <SessionRevokeDialog session={session} />}
      </div>
    </Card>
  );
}
