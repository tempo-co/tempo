import {useNavigate} from '@tanstack/react-router';
import {ChevronLeft, ChevronRight, SlidersHorizontal} from 'lucide-react';
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
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {ScrollArea} from '@/components/ui/scroll-area';
import {useBankTransactionFilterLabels} from '@/hooks/use-bank-transaction-filter-labels';
import {useIsMobile} from '@/hooks/use-is-mobile';
import {cn} from '@/utils/cn';

import {useActiveBankAccounts} from '../api/use-active-bank-accounts';
import {useGetAllBankConnections} from '../api/use-get-all-bank-connections';
import type {BankTransactionFilterParams} from '../types/bank-transaction';
import {BankTransactionAccountFilter} from './bank-transaction-account-filter';
import {BankTransactionBaseAmountFilter} from './bank-transaction-base-amount-filter';
import {BankTransactionCashFlowFilter} from './bank-transaction-cash-flow-filter';
import {BankTransactionCategoryFilter} from './bank-transaction-category-filter';
import {BankTransactionCategorySourceFilter} from './bank-transaction-category-source-filter';
import {BankTransactionDateFilter} from './bank-transaction-date-filter';

type FacetKey =
  'bookingDate' | 'categories' | 'cashFlows' | 'bankAccountIds' | 'categorySources' | 'baseAmount';

type Facet = {
  key: FacetKey;
  label: string;
  summary: string | undefined;
  /** Whether the filter holds a value; its summary can be empty while it does (an account no longer active). */
  isSet: boolean;
  pane: React.ReactNode;
};

const hasValue = (value: unknown) =>
  Array.isArray(value)
    ? value.length > 0
    : value && typeof value === 'object'
      ? Object.values(value).some(Boolean)
      : Boolean(value);

/** The filters the panel holds, in order; the date joins them on phones, where it has no control of its own. */
function useFacets(filters: BankTransactionFilterParams, isMobile: boolean): Facet[] {
  const labels = useBankTransactionFilterLabels(filters);
  const summary = (key: FacetKey) => labels.find((label) => label.key === key)?.label;
  const {showsAccountFilter} = useActiveBankAccounts();
  const currency = useGetAllBankConnections().bankConnections?.find(
    (connection) => connection.baseCurrency,
  )?.baseCurrency;
  const facets: (Omit<Facet, 'isSet'> | false)[] = [
    isMobile && {
      key: 'bookingDate',
      label: 'Booking date',
      summary: summary('bookingDate'),
      pane: <BankTransactionDateFilter filters={filters} variant='pane' />,
    },
    {
      key: 'categories',
      label: 'Categories',
      summary: summary('categories'),
      pane: <BankTransactionCategoryFilter filters={filters} />,
    },
    {
      key: 'cashFlows',
      label: 'Cash flow',
      summary: summary('cashFlows'),
      pane: <BankTransactionCashFlowFilter filters={filters} />,
    },
    showsAccountFilter && {
      key: 'bankAccountIds',
      label: 'Bank accounts',
      summary: summary('bankAccountIds'),
      pane: <BankTransactionAccountFilter filters={filters} />,
    },
    {
      key: 'categorySources',
      label: 'Category source',
      summary: summary('categorySources'),
      pane: <BankTransactionCategorySourceFilter filters={filters} />,
    },
    {
      key: 'baseAmount',
      label: `Amount in ${currency ?? 'base currency'}`,
      summary: summary('baseAmount'),
      pane: <BankTransactionBaseAmountFilter filters={filters} />,
    },
  ];
  return facets
    .filter((facet): facet is Omit<Facet, 'isSet'> => Boolean(facet))
    .map((facet) => ({...facet, isSet: hasValue(filters[facet.key])}));
}

type FiltersProps = {
  filters: BankTransactionFilterParams;
  isFilteringApplied: boolean;
  onClearFilters: () => void;
};

/**
 * One Filters control. Larger screens get a two-pane popover: the filters on the left, the chosen one's options on
 * the right, which is the only part that scrolls. Phones get one bottom sheet stepped through: the filters, then
 * one filter's options, at one height.
 */
export function BankTransactionFilters({
  filters,
  isFilteringApplied,
  onClearFilters,
}: FiltersProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const facets = useFacets(filters, isMobile);
  const count = facets.filter((facet) => facet.isSet).length;
  const [active, setActive] = React.useState<FacetKey | null>(null);
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setActive(null);
  };
  const navigate = useNavigate({from: '/bank-transactions/'});
  // Each filter's Reset sits in the fixed footer, so a long list never hides it at its end.
  const resetButton = (facet: Facet | undefined, className?: string) =>
    facet?.isSet && (
      <Button
        variant='ghost'
        size={isMobile ? 'default' : 'sm'}
        className={className}
        aria-label={`Reset ${facet.label}`}
        onClick={() => void navigate({search: (prev) => ({...prev, [facet.key]: undefined})})}
      >
        Reset
      </Button>
    );

  const trigger = (
    <Button
      variant='outline'
      size='sm'
      className={cn('h-12 shrink-0 px-3 sm:h-8', count > 0 ? 'border' : 'border-dashed')}
      data-testid='bank-transaction-filters-trigger'
    >
      <SlidersHorizontal aria-hidden='true' />
      Filters
      {count > 0 && (
        <Badge variant='secondary' className='rounded-sm px-1 font-normal'>
          {count}
        </Badge>
      )}
    </Button>
  );

  if (!isMobile) {
    const shown = facets.find((facet) => facet.key === active) ?? facets[0];
    return (
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align='end'
          className='flex h-[min(28rem,var(--radix-popover-content-available-height))] w-[38rem] flex-col p-0'
          data-testid='bank-transaction-filters'
        >
          <div className='grid min-h-0 flex-1 grid-cols-[12.5rem_minmax(0,1fr)]'>
            <div
              role='tablist'
              aria-orientation='vertical'
              aria-label='Filters'
              className='flex flex-col gap-0.5 border-r p-2'
            >
              {facets.map((facet) => {
                const selected = facet.key === shown.key;
                return (
                  <button
                    key={facet.key}
                    type='button'
                    role='tab'
                    aria-selected={selected}
                    onClick={() => setActive(facet.key)}
                    className={cn(
                      'grid min-h-11 content-center rounded-sm px-3 py-1.5 text-left text-sm hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      selected && 'bg-accent',
                    )}
                  >
                    <span className={cn(selected && 'font-medium')}>{facet.label}</span>
                    {facet.summary && (
                      <span className='truncate text-xs text-primary'>{facet.summary}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <ScrollArea role='tabpanel' aria-label={shown.label} className='min-h-0'>
              <div className='p-2'>{shown.pane}</div>
            </ScrollArea>
          </div>
          <div className='flex items-center justify-end gap-2 border-t px-2 py-1.5'>
            {resetButton(shown, 'mr-auto')}
            <Button
              variant='ghost'
              size='sm'
              onClick={onClearFilters}
              disabled={!isFilteringApplied}
            >
              Clear all
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  const shown = facets.find((facet) => facet.key === active);
  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent
        data-testid='bank-transaction-filters'
        className='h-[min(85dvh,46rem)] overflow-hidden p-0'
      >
        <DrawerHeader className='flex h-14 flex-row items-center gap-1 border-b px-2 py-0 text-left'>
          {shown ? (
            <>
              <Button
                variant='ghost'
                size='icon'
                className='size-11'
                aria-label='Back to filters'
                onClick={() => setActive(null)}
              >
                <ChevronLeft />
              </Button>
              <DrawerTitle>{shown.label}</DrawerTitle>
            </>
          ) : (
            <DrawerTitle className='px-2'>Filters</DrawerTitle>
          )}
        </DrawerHeader>
        <ScrollArea className='min-h-0 flex-1' data-testid='bank-transaction-filters-scroll-area'>
          {shown ? (
            <div className='px-2 py-2 [&_[cmdk-item]]:min-h-11'>{shown.pane}</div>
          ) : (
            <ul className='divide-y divide-border/60 px-2'>
              {facets.map((facet) => (
                <li key={facet.key}>
                  <button
                    type='button'
                    onClick={() => setActive(facet.key)}
                    className='flex min-h-14 w-full items-center gap-3 px-2 text-left'
                  >
                    <span className='flex-1 text-sm'>{facet.label}</span>
                    <span className='max-w-[55%] truncate text-sm text-primary'>
                      {facet.summary ?? <span className='text-muted-foreground'>Any</span>}
                    </span>
                    <ChevronRight aria-hidden='true' className='size-4 text-muted-foreground' />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        <DrawerFooter className='mt-0 flex-row items-center justify-end gap-2 border-t px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]'>
          {resetButton(shown, 'mr-auto')}
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
