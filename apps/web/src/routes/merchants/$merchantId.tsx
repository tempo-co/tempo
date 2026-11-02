import {Link, createFileRoute} from '@tanstack/react-router';
import {MERCHANT_GROUP_ID_PATTERN} from '@tempo/contracts';
import {FileQuestion, RefreshCw} from 'lucide-react';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {LoadingBar} from '@/components/shared/loading-bar';
import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';
import {useGetMerchant} from '@/features/merchants/api/use-get-merchant';
import {MerchantDetail} from '@/features/merchants/components/merchant-detail';
import {HttpError} from '@/utils/api';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

const GROUP_ID = new RegExp(MERCHANT_GROUP_ID_PATTERN);

export const Route = createFileRoute('/merchants/$merchantId')({
  component: MerchantPage,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function MerchantPage() {
  const {merchantId} = Route.useParams();
  return (
    <AppBodyLayout>
      {GROUP_ID.test(merchantId) ? <Merchant id={merchantId} /> : <MerchantNotFound />}
    </AppBodyLayout>
  );
}

function Merchant({id}: {id: string}) {
  const {merchant, isPending, isError, error, refetch} = useGetMerchant(id);
  if (isPending)
    return (
      <>
        <LoadingBar isPending />
        <Skeleton className='h-96' role='img' aria-label='Loading merchant' />
      </>
    );
  if (error instanceof HttpError && error.status === 404) return <MerchantNotFound />;
  if (isError || !merchant)
    return (
      <EmptyState
        tone='error'
        icon={RefreshCw}
        title='Could not load this merchant'
        description='The service did not respond. Try again in a moment.'
      >
        <Button variant='outline' onClick={() => void refetch()}>
          Try again
        </Button>
      </EmptyState>
    );
  return <MerchantDetail key={merchant.id} merchant={merchant} />;
}

function MerchantNotFound() {
  return (
    <EmptyState
      icon={FileQuestion}
      title='Merchant not found'
      description='There are no transactions with this merchant, or its name changed.'
    >
      <Button variant='outline' asChild>
        <Link to='/merchants'>All merchants</Link>
      </Button>
    </EmptyState>
  );
}
