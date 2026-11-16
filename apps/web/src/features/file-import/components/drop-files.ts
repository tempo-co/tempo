import {useSyncExternalStore} from 'react';

import {useIsMobile} from '@/hooks/use-is-mobile';

let finePointerQuery: MediaQueryList | undefined;
const getFinePointerQuery = () => (finePointerQuery ??= matchMedia('(pointer: fine)'));

const subscribe = (onChange: () => void) => {
  const query = getFinePointerQuery();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const getSnapshot = () => getFinePointerQuery().matches;

/** Whether files can be dropped here: a fine pointer on a layout wider than a phone. */
export function useCanDropFiles() {
  const isMobile = useIsMobile();
  const fine = useSyncExternalStore(subscribe, getSnapshot);
  return fine && !isMobile;
}

/** Whether a drag carries files, rather than text or a link. */
export function dragHasFiles(event: {dataTransfer: DataTransfer | null}) {
  return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
}
