import {useCallback, useEffect, useState} from 'react';

export const useLocalStorage = <T>(key: string, initialValue: T) => {
  const parse = useCallback((item: string | null, defaultValue: T): T => {
    try {
      return item ? (JSON.parse(item) as T) : defaultValue;
    } catch (err) {
      return defaultValue;
    }
  }, []);

  const [storedValue, setStoredValue] = useState<T>(() => {
    const item = window.localStorage.getItem(key);
    return parse(item, initialValue);
  });

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      try {
        const valueToStore = value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      } catch (err) {
        return;
      }
    },
    [key, storedValue],
  );

  useEffect(() => {
    setValue(storedValue);
  }, [storedValue, setValue]);

  return [storedValue, setValue] as const;
};
