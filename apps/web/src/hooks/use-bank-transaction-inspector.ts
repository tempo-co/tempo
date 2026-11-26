import {hashKey} from '@tanstack/react-query';
import {useNavigate, useRouter, useRouterState} from '@tanstack/react-router';
import {useEffect, useRef} from 'react';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /**
     * History index of the entry where the details first showed: a row opened from the list, or a link from another
     * page. Rows opened beside it and links inside its details carry it on. 0 marks the list changed beside the
     * details, which Close keeps.
     */
    transactionOpenedAt?: number;
  }
}

/** Where the open details first showed in this visit: that history entry and the list's address there. */
type Shown = {index: number; view: string};

const viewOf = (search: Record<string, unknown>) =>
  hashKey([{...search, transactionId: undefined}]);

/**
 * Opens a row's details and closes them. Close returns to the entry before the details first showed (the list a row
 * was opened from, or the page a link came from), past rows opened since; once the list itself changed beside the
 * details, Close keeps that list and leaves the details in place.
 */
export function useBankTransactionInspector() {
  const navigate = useNavigate({from: '/transactions/'});
  const router = useRouter();
  const pendingCloseRef = useRef<(() => void) | null>(null);
  const transactionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const shownRef = useRef<Shown | null>(null);
  const location = useRouterState({select: (state) => state.location});
  const isOpen = Boolean((location.search as {transactionId?: string}).transactionId);
  const index = location.state.__TSR_index;
  const view = viewOf(location.search);
  useEffect(() => {
    if (!isOpen) {
      shownRef.current = null;
      return;
    }
    shownRef.current ??= {index, view};
    // Marked in the entry itself, so Close does the same after a reload or a return through history too.
    const {location: current} = router.history;
    if (current.state.transactionOpenedAt === undefined)
      router.history.replace(current.href, {
        ...current.state,
        transactionOpenedAt: view === shownRef.current.view ? shownRef.current.index : 0,
      });
  }, [isOpen, index, view, router]);

  useEffect(() => () => pendingCloseRef.current?.(), []);

  const openTransaction = (selectedTransactionId: string, trigger: HTMLButtonElement) => {
    transactionTriggerRef.current = trigger;
    const {state} = router.history.location;
    // A row opened while another is open beside the list keeps that one's opener, so Close returns to the list.
    const opener = isOpen ? state.transactionOpenedAt : state.__TSR_index + 1;
    void navigate({
      search: (prev) => ({...prev, transactionId: selectedTransactionId}),
      state: {transactionOpenedAt: opener},
    });
  };

  const closeTransaction = (open: boolean) => {
    if (open || pendingCloseRef.current) return;

    const trigger = transactionTriggerRef.current;
    transactionTriggerRef.current = null;
    const {state} = router.history.location;
    // An entry marked 0 is the list changed beside the details, which Close keeps instead of stepping back.
    const openedAt = state.transactionOpenedAt ?? 0;
    if (openedAt > 0) {
      // Return to the entry before the details first showed, then restore focus once its trap is gone.
      const unsubscribe = router.subscribe('onResolved', () => {
        unsubscribe();
        pendingCloseRef.current = null;
        if (trigger?.isConnected) trigger.focus();
      });
      pendingCloseRef.current = unsubscribe;
      router.history.go(openedAt - 1 - state.__TSR_index);
      return;
    }

    void navigate({
      replace: true,
      search: (prev) => ({...prev, transactionId: undefined}),
    }).then(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

  return {openTransaction, closeTransaction};
}
