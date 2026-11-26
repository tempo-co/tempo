import {useNavigate} from '@tanstack/react-router';
import {ChevronLeft, ChevronRight, Plus} from 'lucide-react';
import * as React from 'react';

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
import type {BankTransactionFilterParams} from '../types/bank-transaction';
import {BankTransactionAccountFilter} from './bank-transaction-account-filter';
import {BankTransactionCashFlowFilter} from './bank-transaction-cash-flow-filter';
import {BankTransactionCategoryFilter} from './bank-transaction-category-filter';
import {BankTransactionCategorySourceFilter} from './bank-transaction-category-source-filter';
import {BankTransactionDateFilter} from './bank-transaction-date-filter';

type FacetKey = 'date' | 'categories' | 'cashFlows' | 'bankAccountIds' | 'categorySources';

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

/** The filters "+ Add filter" offers, in order. */
function useFacets(filters: BankTransactionFilterParams): Facet[] {
  const labels = useBankTransactionFilterLabels(filters);
  const summary = (key: FacetKey) => labels.find((label) => label.key === key)?.label;
  const {showsAccountFilter} = useActiveBankAccounts();
  const facets: (Omit<Facet, 'isSet'> | false)[] = [
    {
      key: 'date',
      label: 'Date',
      summary: summary('date'),
      pane: <BankTransactionDateFilter filters={filters} />,
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
  ];
  return facets
    .filter((facet): facet is Omit<Facet, 'isSet'> => Boolean(facet))
    .map((facet) => ({...facet, isSet: hasValue(filters[facet.key])}));
}

/**
 * "+ Add filter": one stepped control, the filters first and then one filter's options at the same size, whose
 * options alone scroll. A popover on larger screens, one bottom sheet on phones. What it sets shows as chips.
 */
export function BankTransactionAddFilter({filters}: {filters: BankTransactionFilterParams}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const facets = useFacets(filters);
  const [active, setActive] = React.useState<FacetKey | null>(null);
  const shown = facets.find((facet) => facet.key === active);
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setActive(null);
  };
  const navigate = useNavigate({from: '/transactions/'});
  // Each filter's Reset sits in the fixed footer, so a long list never hides it at its end.
  const resetButton = shown?.isSet && (
    <Button
      variant='ghost'
      size={isMobile ? 'default' : 'sm'}
      className='mr-auto'
      aria-label={`Reset ${shown.label}`}
      onClick={() => void navigate({search: (prev) => ({...prev, [shown.key]: undefined})})}
    >
      Reset
    </Button>
  );

  const trigger = (
    <Button
      variant='outline'
      size='sm'
      className='h-10 shrink-0 border-dashed font-normal sm:h-8'
      data-testid='bank-transaction-filters-trigger'
    >
      <Plus aria-hidden='true' />
      Add filter
    </Button>
  );

  const header = (
    <div className='flex h-14 shrink-0 items-center gap-1 border-b px-2 md:h-11'>
      {shown ? (
        <>
          <Button
            variant='ghost'
            size='icon'
            className='size-11 md:size-8'
            aria-label='Back to filters'
            onClick={() => setActive(null)}
          >
            <ChevronLeft />
          </Button>
          <FilterTitle mobile={isMobile}>{shown.label}</FilterTitle>
        </>
      ) : (
        <FilterTitle mobile={isMobile} className='px-2'>
          Filters
        </FilterTitle>
      )}
    </div>
  );

  const body = (
    <ScrollArea className='min-h-0 flex-1' data-testid='bank-transaction-filters-scroll-area'>
      {shown ? (
        <div className='p-2 max-md:[&_[cmdk-item]]:min-h-11'>{shown.pane}</div>
      ) : (
        <ul className='divide-y divide-border/60 px-2'>
          {facets.map((facet) => (
            <li key={facet.key}>
              <button
                type='button'
                onClick={() => setActive(facet.key)}
                className='flex min-h-14 w-full items-center gap-3 rounded-sm px-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:min-h-11 md:hover:bg-accent/60'
              >
                <span className='flex-1 text-body'>{facet.label}</span>
                <span className='max-w-[55%] truncate text-body text-primary'>
                  {facet.summary ?? <span className='text-muted-foreground'>Any</span>}
                </span>
                <ChevronRight aria-hidden='true' className='size-4 text-muted-foreground' />
              </button>
            </li>
          ))}
        </ul>
      )}
    </ScrollArea>
  );

  if (!isMobile) {
    return (
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align='start'
          className='flex h-[min(--spacing(120),var(--radix-popover-content-available-height))] w-88 flex-col p-0'
          data-testid='bank-transaction-filters'
        >
          {header}
          {body}
          {resetButton && (
            <div className='flex shrink-0 items-center border-t px-2 py-1.5'>{resetButton}</div>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent
        data-testid='bank-transaction-filters'
        className='h-[min(85dvh,--spacing(184))] overflow-hidden p-0'
      >
        <DrawerHeader className='p-0 text-left'>{header}</DrawerHeader>
        {body}
        <DrawerFooter className='mt-0 flex-row items-center justify-end gap-2 border-t px-4 py-3 pb-[calc(--spacing(3)+env(safe-area-inset-bottom))]'>
          {resetButton}
          <DrawerClose asChild>
            <Button>Done</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/** The step's name: the drawer's title on phones, a heading in the popover. */
function FilterTitle({
  mobile,
  className,
  children,
}: {
  mobile: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return mobile ? (
    <DrawerTitle className={className}>{children}</DrawerTitle>
  ) : (
    <h2 className={cn('text-body font-medium', className)}>{children}</h2>
  );
}
