import {useEffect, useState} from 'react';

/** The current time, moving on each minute, so "2 min ago" lines on an open page don't go stale. */
export function useNow() {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}
