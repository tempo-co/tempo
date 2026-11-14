import {format, isToday} from 'date-fns';
import {CloudOff, WifiOff} from 'lucide-react';

import {HttpError, NetworkError} from '@/utils/api';

/** When a load failed, for its detail line: the time today, else the day and time. */
export const failedAtLabel = (time: number) =>
  format(time, isToday(time) ? 'HH:mm' : 'd MMM, HH:mm');

/** What a failed load says about its cause: offline, no answer, or an error reply. */
export function describeFailure(error: unknown) {
  if (!navigator.onLine)
    return {
      offline: true,
      icon: WifiOff,
      description: 'This loads once the device is back online.',
      code: null,
    } as const;
  // A request without a reply, or one paused until the server answers again.
  if (error instanceof NetworkError || error == null)
    return {
      offline: false,
      icon: CloudOff,
      description: "The server can't be reached right now.",
      code: 'No response',
    } as const;
  if (error instanceof HttpError)
    return {
      offline: false,
      icon: CloudOff,
      description:
        error.status >= 500
          ? 'The server ran into a problem.'
          : error.status === 429
            ? 'Too many requests for now. Wait a moment.'
            : 'The server turned the request down.',
      code: String(error.status),
    } as const;
  return {
    offline: false,
    icon: CloudOff,
    description: 'Something went wrong while loading.',
    code: null,
  } as const;
}
