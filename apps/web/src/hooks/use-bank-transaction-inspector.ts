import {useNavigate} from '@tanstack/react-router';
import {useRef} from 'react';

type BankTransactionInspectorRoute = '/bank-connections/' | '/bank-transactions/';

export function useBankTransactionInspector(route: BankTransactionInspectorRoute) {
  const navigate = useNavigate({from: route});
  const transactionTriggerRef = useRef<HTMLButtonElement | null>(null);

  const openTransaction = (selectedTransactionId: string, trigger: HTMLButtonElement) => {
    transactionTriggerRef.current = trigger;
    void navigate({
      search: (prev) => ({...prev, transactionId: selectedTransactionId}),
    });
  };

  const closeTransaction = (open: boolean) => {
    if (open) return;

    const trigger = transactionTriggerRef.current;
    transactionTriggerRef.current = null;
    void navigate({
      replace: true,
      search: (prev) => ({...prev, transactionId: undefined}),
    }).then(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

  return {openTransaction, closeTransaction};
}
