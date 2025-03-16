import {ColumnDef} from '@tanstack/react-table';
import {format} from 'date-fns';
import {ArrowDown, ArrowDownUp, ArrowUp} from 'lucide-react';

import {CategoryBadge} from '@/components/shared/category-badge';
import {CurrencyAmount} from '@/components/shared/currency-amount';
import {Button} from '@/components/ui/button';
import {Transaction} from '@/types/transaction';

export const transactionsTableColumns: ColumnDef<Transaction>[] = [
  {
    accessorKey: 'category',
    header: () => {
      return <p className='px-3'>Category</p>;
    },
    cell: ({row}) => {
      return <CategoryBadge category={row.original.category} />;
    },
  },
  {
    accessorKey: 'startedAt',
    header: ({column}) => {
      const sortDirection = column.getIsSorted();
      return (
        <Button
          variant='ghost'
          onClick={() => {
            if (sortDirection === 'desc') {
              column.toggleSorting(false);
            } else if (sortDirection === 'asc') {
              column.clearSorting();
            } else {
              column.toggleSorting(true);
            }
          }}
          className='flex h-12 w-full justify-start px-3'
        >
          Started at
          {!sortDirection && <ArrowDownUp className='text-muted-foreground' />}
          {sortDirection === 'asc' && <ArrowUp className='h-4 w-4 text-secondary-foreground' />}
          {sortDirection === 'desc' && <ArrowDown className='h-4 w-4 text-secondary-foreground' />}
        </Button>
      );
    },
    cell: ({row}) => {
      return <p>{format(new Date(row.original.startedAt), 'MMM d, yyyy')}</p>;
    },
  },
  {
    accessorKey: 'description',
    header: () => {
      return <p className='px-3'>Description</p>;
    },
    cell: ({row}) => {
      return (
        <p className='max-w-[6rem] overflow-hidden text-ellipsis whitespace-nowrap lg:max-w-[20rem] xl:max-w-[36rem] 2xl:max-w-[50rem]'>
          {row.original.description}
        </p>
      );
    },
  },
  {
    accessorKey: 'amount',
    header: ({column}) => {
      const sortDirection = column.getIsSorted();
      return (
        <Button
          variant='ghost'
          onClick={() => {
            if (sortDirection === 'desc') {
              column.toggleSorting(false);
            } else if (sortDirection === 'asc') {
              column.clearSorting();
            } else {
              column.toggleSorting(true);
            }
          }}
          className='flex h-12 w-full justify-end px-3'
        >
          {!sortDirection && <ArrowDownUp className='text-muted-foreground' />}
          {sortDirection === 'asc' && <ArrowUp className='h-4 w-4 text-secondary-foreground' />}
          {sortDirection === 'desc' && <ArrowDown className='h-4 w-4 text-secondary-foreground' />}
          Amount
        </Button>
      );
    },
    cell: ({row}) => {
      return (
        <p className='text-right'>
          <CurrencyAmount amount={row.original.amount} currency={row.original.currency} />
        </p>
      );
    },
  },
];
