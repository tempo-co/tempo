import {Check} from 'lucide-react';

import {Badge} from '@/components/ui/badge';
import {Separator} from '@/components/ui/separator';
import {cn} from '@/utils/cn';

type FilterCheckIndicatorProps = {
  isSelected: boolean;
  className?: string;
};

export function FilterCheckIndicator({isSelected, className = 'mr-2'}: FilterCheckIndicatorProps) {
  return (
    <div
      className={cn(
        'flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
        className,
        isSelected ? 'bg-primary text-primary-foreground' : 'opacity-50 [&_svg]:invisible',
      )}
    >
      <Check />
    </div>
  );
}

type SelectedFilterSummaryProps = {
  items: {key: string; label: string}[];
};

export function SelectedFilterSummary({items}: SelectedFilterSummaryProps) {
  if (items.length === 0) return null;

  return (
    <>
      <Separator orientation='vertical' className='mx-2 h-4' />
      <Badge variant='secondary' className='rounded-sm px-1 font-normal lg:hidden'>
        {items.length}
      </Badge>
      <div className='hidden space-x-1 lg:flex'>
        {items.length > 2 ? (
          <Badge variant='secondary' className='rounded-sm px-2 font-normal'>
            {items.length} selected
          </Badge>
        ) : (
          items.map(({key, label}) => (
            <span className='rounded bg-accent px-1.5 py-0.5 text-xs' key={key}>
              {label}
            </span>
          ))
        )}
      </div>
    </>
  );
}
