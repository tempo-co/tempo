import {useNavigate} from '@tanstack/react-router';
import {ArrowDownUp, Check} from 'lucide-react';
import * as React from 'react';

import {Button} from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {useIsMobile} from '@/hooks/use-is-mobile';
import {cn} from '@/utils/cn';

import type {BankTransactionSortParams} from '../types/bank-transaction';

const SORTS = {
  newest: {label: 'Newest first', sort: {by: 'bookingDate', order: 'DESC'}},
  oldest: {label: 'Oldest first', sort: {by: 'bookingDate', order: 'ASC'}},
  out: {label: 'Largest out first', sort: {by: 'amount', order: 'ASC'}},
  in: {label: 'Largest in first', sort: {by: 'amount', order: 'DESC'}},
} as const satisfies Record<string, {label: string; sort: NonNullable<BankTransactionSortParams>}>;
type SortId = keyof typeof SORTS;
const SORT_IDS = Object.keys(SORTS) as SortId[];

const sortIdOf = (sort: NonNullable<BankTransactionSortParams>): SortId =>
  SORT_IDS.find((id) => SORTS[id].sort.by === sort.by && SORTS[id].sort.order === sort.order) ??
  'newest';

/** The list's order: by date (grouped by day) or by amount (flat, dates on the rows). A sheet on phones. */
export function BankTransactionSortMenu({sort}: {sort: NonNullable<BankTransactionSortParams>}) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const current = sortIdOf(sort);
  const select = (id: SortId) =>
    void navigate({
      search: (prev) => ({
        ...prev,
        sort: id === 'newest' ? undefined : SORTS[id].sort,
      }),
    });

  const trigger = (
    <Button
      variant='outline'
      size='sm'
      className={cn(
        'h-12 shrink-0 px-3 max-md:w-12 sm:h-8',
        current === 'newest' && 'border-dashed',
      )}
      aria-label={`Order: ${SORTS[current].label}`}
    >
      <ArrowDownUp aria-hidden='true' />
      <span className='max-md:sr-only'>{SORTS[current].label}</span>
    </Button>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent data-testid='bank-transaction-order' className='p-0'>
          <DrawerHeader className='flex h-14 flex-row items-center border-b px-4 py-0 text-left'>
            <DrawerTitle>Order</DrawerTitle>
          </DrawerHeader>
          <div
            role='radiogroup'
            aria-label='Order'
            className='divide-y divide-border/60 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]'
          >
            {SORT_IDS.map((id) => (
              <button
                key={id}
                type='button'
                role='radio'
                aria-checked={id === current}
                onClick={() => {
                  select(id);
                  setOpen(false);
                }}
                className='flex min-h-14 w-full items-center justify-between px-2 text-left text-sm'
              >
                {SORTS[id].label}
                {id === current && <Check aria-hidden='true' className='size-4 text-primary' />}
              </button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-48'>
        <DropdownMenuLabel className='text-xs font-normal text-muted-foreground'>
          Order
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current} onValueChange={(id) => select(id as SortId)}>
          {SORT_IDS.map((id) => (
            <DropdownMenuRadioItem key={id} value={id}>
              {SORTS[id].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
