import type {HeaderContext} from '@tanstack/react-table';
import {ArrowDown, ArrowDownUp, ArrowUp} from 'lucide-react';
import type {ReactNode} from 'react';

import {Button} from '@/components/ui/button';
import {cn} from '@/utils/cn';

type SortButtonProps<TData> = {
  column: HeaderContext<TData, unknown>['column'];
  children: ReactNode;
  className?: string;
  iconPosition?: 'before' | 'after';
};

function SortIcon({direction}: {direction: false | 'asc' | 'desc'}) {
  if (direction === 'asc') return <ArrowUp className='h-4 w-4 text-secondary-foreground' />;
  if (direction === 'desc') return <ArrowDown className='h-4 w-4 text-secondary-foreground' />;
  return <ArrowDownUp className='text-muted-foreground' />;
}

export function SortButton<TData>({
  column,
  children,
  className,
  iconPosition = 'after',
}: SortButtonProps<TData>) {
  const direction = column.getIsSorted();
  const sortIcon = <SortIcon direction={direction} />;

  return (
    <Button
      variant='ghost'
      onClick={() => {
        if (direction === 'desc') column.toggleSorting(false);
        else if (direction === 'asc') column.clearSorting();
        else column.toggleSorting(true);
      }}
      className={cn('flex h-12 w-full justify-start px-3', className)}
    >
      {iconPosition === 'before' && sortIcon}
      {children}
      {iconPosition === 'after' && sortIcon}
    </Button>
  );
}
