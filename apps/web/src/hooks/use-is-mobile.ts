import {useEffect, useState} from 'react';

const MOBILE_BREAKPOINT = 768;

export const useIsMobile = () => {
  const [value, setValue] = useState(false);

  useEffect(() => {
    function onChange(event: MediaQueryListEvent) {
      setValue(event.matches);
    }

    const result = matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    result.addEventListener('change', onChange);
    setValue(result.matches);

    return () => result.removeEventListener('change', onChange);
  }, []);

  return value;
};
