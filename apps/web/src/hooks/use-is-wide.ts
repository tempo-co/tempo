import {useSyncExternalStore} from 'react';

/** Tailwind's `lg`: wide enough for a details rail beside a page's list. */
const WIDE_QUERY = '(min-width: 1024px)';

let wideQuery: MediaQueryList | undefined;
const getWideQuery = () => (wideQuery ??= matchMedia(WIDE_QUERY));

const subscribe = (onChange: () => void) => {
  const query = getWideQuery();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const getSnapshot = () => getWideQuery().matches;

export const useIsWide = () => useSyncExternalStore(subscribe, getSnapshot);
