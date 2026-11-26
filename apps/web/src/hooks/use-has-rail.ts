import {useSyncExternalStore} from 'react';

/** Tailwind's `lg`: from here a page has room for its right rail beside the list. */
const RAIL_BREAKPOINT = 1024;

let railQuery: MediaQueryList | undefined;
const getRailQuery = () => (railQuery ??= matchMedia(`(min-width: ${RAIL_BREAKPOINT}px)`));

const subscribe = (onChange: () => void) => {
  const query = getRailQuery();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const getSnapshot = () => getRailQuery().matches;

/** Whether the page shows details in its right rail; below it they open in a bottom sheet. */
export const useHasRail = () => useSyncExternalStore(subscribe, getSnapshot);
