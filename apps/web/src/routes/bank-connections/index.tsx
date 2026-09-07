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
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

const searchSchema = z.object({
  result: z.enum(['connected', 'cancelled', 'error']).optional(),
});

export const Route = createFileRoute('/bank-connections/')({
  component: BankConnectionsIndex,
  validateSearch: zodValidator(searchSchema),
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function BankConnectionsIndex() {
  const navigate = useNavigate();
  const {result} = Route.useSearch();
  const {bankConnections, isPending} = useGetAllBankConnections();

  useEffect(() => {
    if (!result) return;

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

    void navigate({to: '/bank-connections', search: {}});
  }, [navigate, result]);

  return (
    <>
      <LoadingBar isPending={isPending} />
      <AppHeaderLayout>
        <span className='text-sm font-medium'>Bank connections</span>
      </AppHeaderLayout>
      <AppBodyLayout>
        <BankConnectionList bankConnections={bankConnections || []} isPending={isPending} />
      </AppBodyLayout>
    </>
  );
}
