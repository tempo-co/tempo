import {createFileRoute, useNavigate} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {useEffect} from 'react';
import {toast} from 'sonner';
import {z} from 'zod';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {AppHeaderLayout} from '@/components/shared/layout/app-header-layout';
import {LoadingBar} from '@/components/shared/loading-bar';
import {useGetAllBankConnections} from '@/features/banking/api/use-get-all-bank-connections';
import {BankConnectionList} from '@/features/banking/components/bank-connection-list';
import {BankTransactionDetailsDialog} from '@/features/banking/components/bank-transaction-details-dialog';
import {
  BANK_CONNECTION_RESULTS,
  BANK_CONNECTION_RESULT_CHANNEL,
  type BankConnectionResult,
  createBankConnectionResultMessage,
  isBankConnectionResultMessage,
} from '@/features/banking/utils/authorization-result';
import {useBankTransactionInspector} from '@/hooks/use-bank-transaction-inspector';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

const searchSchema = z.object({
  result: z.enum(BANK_CONNECTION_RESULTS).optional(),
  transactionId: z.string().optional(),
});

export const Route = createFileRoute('/bank-connections/')({
  component: BankConnectionsIndex,
  validateSearch: zodValidator(searchSchema),
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function showBankConnectionResult(result: BankConnectionResult) {
  if (result === 'connected') {
    toast.success('Bank connection added', {id: 'bank-connection-success'});
  } else if (result === 'cancelled') {
    toast.info('Bank connection cancelled', {id: 'bank-connection-cancelled'});
  } else {
    toast.error('Bank connection failed', {
      description: 'No bank account data was changed. Please try again.',
      id: 'bank-connection-error',
    });
  }
}

function getBankConnectionOpener(): Window | null {
  const opener: unknown = window.opener;
  if (typeof opener !== 'object' || opener === null) return null;
  if (!('closed' in opener) || !('postMessage' in opener)) return null;

  return opener as Window;
}

function publishBankConnectionResult(result: BankConnectionResult) {
  const message = createBankConnectionResultMessage(result);
  const opener = getBankConnectionOpener();

  if (opener && !opener.closed) {
    try {
      opener.postMessage(message, window.location.origin);
      return true;
    } catch {
      // The browser may detach the opener after crossing the provider boundary.
    }
  }

  if (typeof BroadcastChannel === 'undefined') return false;

  const channel = new BroadcastChannel(BANK_CONNECTION_RESULT_CHANNEL);
  channel.postMessage(message);
  channel.close();
  return true;
}

function BankConnectionsIndex() {
  const navigate = useNavigate();
  const {result, transactionId} = Route.useSearch();
  const isCallbackPopup = Boolean(result && getBankConnectionOpener());
  const {openTransaction, closeTransaction} = useBankTransactionInspector('/bank-connections/');
  const {bankConnections, isPending, isError, refetch} = useGetAllBankConnections(!isCallbackPopup);

  useEffect(() => {
    const handleResult = (value: unknown) => {
      if (!isBankConnectionResultMessage(value)) return;

      showBankConnectionResult(value.result);
      void refetch();
    };
    const handleWindowMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;
      handleResult(event.data);
    };

    window.addEventListener('message', handleWindowMessage);
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? undefined
        : new BroadcastChannel(BANK_CONNECTION_RESULT_CHANNEL);
    if (channel) {
      channel.onmessage = (event) => handleResult(event.data);
    }

    return () => {
      window.removeEventListener('message', handleWindowMessage);
      channel?.close();
    };
  }, [refetch]);

  useEffect(() => {
    if (!result) return;

    const opener = getBankConnectionOpener();
    if (publishBankConnectionResult(result) && opener && !opener.closed) {
      window.close();
      const fallbackTimeout = window.setTimeout(() => {
        if (window.closed) return;
        showBankConnectionResult(result);
        void navigate({to: '/bank-connections', search: {}});
      }, 250);
      return () => window.clearTimeout(fallbackTimeout);
    }

    showBankConnectionResult(result);
    void navigate({to: '/bank-connections', search: {}});
  }, [navigate, result]);

  return (
    <>
      <LoadingBar isPending={isPending} />
      <AppHeaderLayout>
        <span className='text-sm font-medium'>Bank connections</span>
      </AppHeaderLayout>
      <AppBodyLayout className='max-md:my-6'>
        <BankConnectionList
          bankConnections={bankConnections || []}
          isPending={isPending}
          isError={isError}
          onRetry={() => void refetch()}
          onTransactionSelect={openTransaction}
        />
      </AppBodyLayout>
      <BankTransactionDetailsDialog
        transactionId={transactionId ?? ''}
        open={Boolean(transactionId)}
        onOpenChange={closeTransaction}
      />
    </>
  );
}
