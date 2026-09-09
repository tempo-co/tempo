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
import {useBankTransactionInspector} from '@/hooks/use-bank-transaction-inspector';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

const bankConnectionResultSchema = z.enum(['connected', 'cancelled', 'error']);

const searchSchema = z.object({
  result: bankConnectionResultSchema.optional(),
  transactionId: z.string().optional(),
});

type BankConnectionResult = z.infer<typeof bankConnectionResultSchema>;

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

function BankConnectionsIndex() {
  const navigate = useNavigate();
  const {result, transactionId} = Route.useSearch();
  const {openTransaction, closeTransaction} = useBankTransactionInspector('/bank-connections/');
  const {bankConnections, isPending, isError, refetch} = useGetAllBankConnections();

  useEffect(() => {
    if (!result) return;

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
