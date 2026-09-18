import {SlidersHorizontal} from 'lucide-react';
import * as React from 'react';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {ScrollArea} from '@/components/ui/scroll-area';
import {cn} from '@/utils/cn';

import {BankTransactionFilterParams} from '../types/bank-transaction';
import {BankTransactionAccountFilter} from './bank-transaction-account-filter';
import {BankTransactionCategoryFilter} from './bank-transaction-category-filter';
import {BankTransactionCategorySourceFilter} from './bank-transaction-category-source-filter';
import {BankTransactionDateFilter} from './bank-transaction-date-filter';
import {BankTransactionFinancialEventFilter} from './bank-transaction-financial-event-filter';

type BankTransactionMobileFiltersProps = {
  filters: BankTransactionFilterParams;
  setFilters: React.Dispatch<React.SetStateAction<BankTransactionFilterParams>>;
  isFilteringApplied: boolean;
  onClearFilters: () => void;
  className?: string;
};

export function BankTransactionMobileFilters({
  filters,
  setFilters,
  isFilteringApplied,
  onClearFilters,
  className,
}: BankTransactionMobileFiltersProps) {
  const [open, setOpen] = React.useState(false);
  const mobileFiltersScrollAreaRef = React.useRef<HTMLDivElement>(null);
  const activeFilterCount = [
    Boolean(filters.bookingDate),
    (filters.bankAccountIds?.length ?? 0) > 0,
    (filters.categories?.length ?? 0) > 0,
    (filters.categorySources?.length ?? 0) > 0,
    (filters.financialEventTypes?.length ?? 0) > 0,
  ].filter(Boolean).length;

  React.useEffect(() => {
    if (!open) return;

    const frame = requestAnimationFrame(() => {
      const scrollArea = mobileFiltersScrollAreaRef.current;
      scrollArea?.scrollTo({top: 0});
      const viewport = scrollArea?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
      viewport?.scrollTo({top: 0});
    });

    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className={cn(
            'h-12 shrink-0 px-3',
            activeFilterCount > 0 ? 'border' : 'border-dashed',
            className,
          )}
          data-testid='bank-transaction-mobile-filters-trigger'
        >
          <SlidersHorizontal aria-hidden='true' />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant='secondary' className='rounded-sm px-1 font-normal'>
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </DrawerTrigger>
      <DrawerContent data-testid='bank-transaction-mobile-filters' className='max-h-[90vh] p-0'>
        <DrawerHeader className='border-b px-4 pb-4 pt-3 text-left'>
          <DrawerTitle>Filters</DrawerTitle>
        </DrawerHeader>
        <ScrollArea
          type='always'
          className='flex h-full min-h-0 flex-1 flex-col [&>[data-radix-scroll-area-viewport]]:h-auto [&>[data-radix-scroll-area-viewport]]:min-h-0 [&>[data-radix-scroll-area-viewport]]:flex-1'
          data-testid='bank-transaction-mobile-filters-scroll-area'
          ref={mobileFiltersScrollAreaRef}
        >
          <div className='px-4 py-4' data-testid='bank-transaction-mobile-filters-body'>
            <BankTransactionDateFilter filters={filters} setFilters={setFilters} variant='mobile' />
            <BankTransactionCategoryFilter
              filters={filters}
              setFilters={setFilters}
              variant='mobile'
            />
            <BankTransactionCategorySourceFilter
              filters={filters}
              setFilters={setFilters}
              variant='mobile'
            />
            <BankTransactionFinancialEventFilter
              filters={filters}
              setFilters={setFilters}
              variant='mobile'
            />
            <BankTransactionAccountFilter
              filters={filters}
              setFilters={setFilters}
              variant='mobile'
            />
          </div>
        </ScrollArea>
        <DrawerFooter className='mt-0 flex-row items-center justify-end gap-2 border-t px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]'>
          <Button variant='ghost' onClick={onClearFilters} disabled={!isFilteringApplied}>
            Clear all
          </Button>
          <DrawerClose asChild>
            <Button>Done</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
