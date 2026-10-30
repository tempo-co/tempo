import {useEffect, useState} from 'react';

import {localDate} from '@/features/dashboard/utils/month';

/** Tracks the local calendar day, including tabs that wake after midnight. */
export function useLocalDate() {
  const [date, setDate] = useState(() => localDate());

  useEffect(() => {
    let timer: number;
    const refresh = () => {
      setDate(localDate());
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, midnight.getTime() - Date.now());
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return date;
}
