import {useQueryClient} from '@tanstack/react-query';
import {format, isToday} from 'date-fns';
import {CloudOff} from 'lucide-react';

import {useIsOnline} from '@/hooks/use-connection';

/** Says that Tempo is unreachable and how recent the data on screen is. */
export function OfflineStatus() {
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();
  if (isOnline) return null;

  // Nothing is refreshed while offline, so the newest saved data is when Tempo last answered.
  const updatedAt = Math.max(
    0,
    ...queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.dataUpdatedAt),
  );

  return (
    <p
      role='status'
      title='Tempo is unreachable. Changes cannot be saved until it reconnects.'
      className='ml-auto flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground'
    >
      <CloudOff className='size-3.5' aria-hidden />
      Offline
      {updatedAt > 0 && (
        <>
          {' · '}
          <span className='max-sm:hidden'>updated </span>
          {format(updatedAt, isToday(updatedAt) ? 'HH:mm' : 'MMM d, HH:mm')}
        </>
      )}
    </p>
  );
}
