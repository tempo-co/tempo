import {ColumnDef} from '@tanstack/react-table';
import dayjs from 'dayjs';
import {ArrowUpDown} from 'lucide-react';

import {CategoryBadge} from '@/components/shared/category-badge';
import {Button} from '@/components/ui/button';
import {Category} from '@/types/category';
import {Transaction} from '@/types/transaction';

const categoryOrder = Object.values(Category).reduce(
  (acc, category, index) => {
    acc[category] = index;
    return acc;
  },
  {} as Record<Category, number>,
);

export const transactionTableColumns: ColumnDef<Transaction>[] = [
  {
    accessorKey: 'category',
    header: ({column}) => {
      return (
        <Button
          variant='ghost'
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className='flex h-12 w-full justify-start px-3'
        >
          <span>Category</span>
          <ArrowUpDown className='ml-2 h-4 w-4' />
        </Button>
      );
    },
    cell: ({row}) => {
      return <CategoryBadge category={row.original.category} />;
    },
    sortingFn: (rowA, rowB) => {
      const categoryA = rowA.original.category;
      const categoryB = rowB.original.category;
      return categoryOrder[categoryA] - categoryOrder[categoryB];
    },
  },
  {
    accessorKey: 'startedAt',
    header: ({column}) => {
      return (
        <Button
          variant='ghost'
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className='h-12 w-full px-3'
        >
          Started date
          <ArrowUpDown className='ml-2 h-4 w-4' />
        </Button>
      );
    },
    cell: ({row}) => {
      return <p>{dayjs(row.original.startedAt).format('DD/MM/YYYY')}</p>;
    },
  },
  {
    accessorKey: 'completedAt',
    header: ({column}) => {
      return (
        <Button
          variant='ghost'
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className='h-12 w-full px-3'
        >
          Completed date
          <ArrowUpDown className='ml-2 h-4 w-4' />
        </Button>
      );
    },
    cell: ({row}) => {
      return <p>{dayjs(row.original.completedAt).format('DD/MM/YYYY')}</p>;
    },
  },
  {
    accessorKey: 'description',
    header: () => {
      return <p className='px-3'>Description</p>;
    },
  },
  {
    accessorKey: 'amount',
    header: ({column}) => {
      return (
        <Button
          variant='ghost'
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className='h-12 w-full px-3'
        >
          Amount
          <ArrowUpDown className='ml-2 h-4 w-4' />
        </Button>
      );
    },
    cell: ({row}) => {
      return <p className='pr-2 text-right'>{row.original.amount.toFixed(2)}</p>;
    },
  },
];
