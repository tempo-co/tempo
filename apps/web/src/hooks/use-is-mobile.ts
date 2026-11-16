import {useSyncExternalStore} from 'react';

const MOBILE_BREAKPOINT = 768;

let mobileQuery: MediaQueryList | undefined;
const getMobileQuery = () =>
  (mobileQuery ??= matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`));

const subscribe = (onChange: () => void) => {
  const query = getMobileQuery();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const getSnapshot = () => getMobileQuery().matches;

export const useIsMobile = () => useSyncExternalStore(subscribe, getSnapshot);
