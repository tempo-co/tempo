import {useNavigate, useRouter} from '@tanstack/react-router';
import {useEffect, useRef} from 'react';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** History index of the entry that opened the transaction inspector; links inside it carry it on. */
    transactionOpenedAt?: number;
  }
}

type BankTransactionInspectorRoute = '/bank-connections/' | '/bank-transactions/';

export function useBankTransactionInspector(route: BankTransactionInspectorRoute) {
  const navigate = useNavigate({from: route});
  const router = useRouter();
  const pendingCloseRef = useRef<(() => void) | null>(null);
  const transactionTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => () => pendingCloseRef.current?.(), []);

  const openTransaction = (selectedTransactionId: string, trigger: HTMLButtonElement) => {
    transactionTriggerRef.current = trigger;
    void navigate({
      search: (prev) => ({...prev, transactionId: selectedTransactionId}),
      state: {transactionOpenedAt: router.history.location.state.__TSR_index + 1},
    });
  };

  const closeTransaction = (open: boolean) => {
    if (open || pendingCloseRef.current) return;

    const trigger = transactionTriggerRef.current;
    transactionTriggerRef.current = null;
    const {state} = router.history.location;
    // An entry without an opener (a link from another page) opened the inspector itself.
    const openedAt = state.transactionOpenedAt ?? state.__TSR_index;
    if (openedAt > 0) {
      // Return to the entry before the inspector opened, then restore focus once its trap is gone.
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
