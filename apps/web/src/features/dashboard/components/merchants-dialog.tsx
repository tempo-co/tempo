import type {CashFlowInterval} from '@tempo/contracts';
import {FileQuestion} from 'lucide-react';
import {useEffect, useState} from 'react';

import {LoadErrorState, StateMessage} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogCornerClose,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Skeleton} from '@/components/ui/skeleton';
import {useGetMerchant} from '@/features/merchants/api/use-get-merchant';
import {MerchantDetail} from '@/features/merchants/components/merchant-detail';
import {MerchantsOverview} from '@/features/merchants/components/merchants-overview';
import {useFiguresCurrencyAccepted} from '@/features/reporting-currency/api/use-reporting-currency';
import {HttpError} from '@/utils/api';

/** Merchant spending over Home: the ranking and every merchant, or one merchant's details. */
export function MerchantsDialog({
  open,
  onOpenChange,
  month,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  selectedId: string | null;
  onSelect: (merchantId: string | null) => void;
}) {
  // Kept here so opening a merchant and coming back keeps the search and ranking period.
  const [searchInput, setSearchInput] = useState('');
  const [interval, setInterval] = useState<CashFlowInterval>('month');
  // A fresh opening starts from this month's ranking without a search.
  useEffect(() => {
    if (open) return;
    setSearchInput('');
    setInterval('month');
  }, [open]);
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        aria-label='Merchants'
        className='flex h-[min(90dvh,56rem)] max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-h-[90vh] sm:max-w-3xl [&>button:last-child]:hidden'
      >
        <ResponsiveDialogCornerClose label='Close merchants' />
        <ResponsiveDialogHeader className='shrink-0 border-b px-5 pt-5 pr-16 pb-4 text-left sm:px-6'>
          <ResponsiveDialogTitle className='text-xl leading-tight sm:text-2xl sm:leading-8'>
            Merchants
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='mt-1 md:mt-0'>
            What you paid businesses and people.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {/* Radix wraps content in a display:table div that grows to its widest row; keep it at the sheet's width. */}
        {/* Keyed so a merchant's details, and the list again, start at the top. */}
        <ScrollArea
          key={selectedId ?? 'list'}
          type='always'
          className='min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block'
        >
          <div className='p-5 sm:p-6'>
            {open &&
              (selectedId ? (
                <SelectedMerchant id={selectedId} onBack={() => onSelect(null)} />
              ) : (
                <MerchantsOverview
                  month={month}
                  onSelect={onSelect}
                  searchInput={searchInput}
                  onSearchInputChange={setSearchInput}
                  interval={interval}
                  onIntervalChange={setInterval}
                />
              ))}
          </div>
        </ScrollArea>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function SelectedMerchant({id, onBack}: {id: string; onBack: () => void}) {
  const {merchant, isPending, isError, error, refetch} = useGetMerchant(id);
  const accepted = useFiguresCurrencyAccepted();
  if (isPending || (merchant && !accepted(merchant.baseCurrency)))
    return <Skeleton className='h-96' role='img' aria-label='Loading merchant' />;
  if (error instanceof HttpError && error.status === 404)
    return (
      <StateMessage
        size='section'
        icon={FileQuestion}
        title='Merchant not found'
        description='There are no transactions with this merchant, or its name changed.'
      >
        <Button variant='outline' size='sm' onClick={onBack}>
          All merchants
        </Button>
      </StateMessage>
    );
  if (isError || !merchant)
    return (
      <LoadErrorState
        size='section'
        title="Couldn't load this merchant"
        error={error}
        onRetry={refetch}
      />
    );
  return <MerchantDetail key={merchant.id} merchant={merchant} onBack={onBack} />;
}
