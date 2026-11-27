import {useCallback, useState} from 'react';

import {type HomeLayout, readHomeLayout} from './utils/home-layout';

/** Kept on this device only: which of Home's cards show, and in what order. */
const HOME_LAYOUT_KEY = 'wisp-home-layout';

function loadLayout(): HomeLayout {
  try {
    return readHomeLayout(window.localStorage.getItem(HOME_LAYOUT_KEY));
  } catch {
    // Storage can be off (private windows, blocked site data); Home then opens in its default layout.
    return readHomeLayout(null);
  }
}

/** Home's layout on this device, and a setter that saves it there. */
export function useHomeLayout() {
  const [layout, setLayout] = useState(loadLayout);
  const update = useCallback((next: HomeLayout) => {
    setLayout(next);
    try {
      window.localStorage.setItem(HOME_LAYOUT_KEY, JSON.stringify(next));
    } catch {
      // Unsaved, it still holds until the page reloads.
    }
  }, []);
  return [layout, update] as const;
}
