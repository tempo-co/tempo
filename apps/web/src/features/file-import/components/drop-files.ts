import {useEffect, useState} from 'react';

import {useIsMobile} from '@/hooks/use-is-mobile';

const FINE_POINTER = '(pointer: fine)';

/** Whether files can be dropped here: a fine pointer on a layout wider than a phone. */
export function useCanDropFiles() {
  const isMobile = useIsMobile();
  const [fine, setFine] = useState(() => matchMedia(FINE_POINTER).matches);
  useEffect(() => {
    const query = matchMedia(FINE_POINTER);
    const onChange = (event: MediaQueryListEvent) => setFine(event.matches);
    query.addEventListener('change', onChange);
    setFine(query.matches);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return fine && !isMobile;
}

/** Whether a drag carries files, rather than text or a link. */
export function dragHasFiles(event: {dataTransfer: DataTransfer | null}) {
  return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
}
