import {Check, Minus} from 'lucide-react';

import {cn} from '@/utils/cn';

type FilterCheckIndicatorProps = {
  isSelected: boolean;
  isMixed?: boolean;
  className?: string;
};

export function FilterCheckIndicator({
  isSelected,
  isMixed = false,
  className = 'mr-2',
}: FilterCheckIndicatorProps) {
  return (
    <div
      className={cn(
        'flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
        className,
        isSelected || isMixed
          ? 'bg-primary text-primary-foreground'
          : 'opacity-50 [&_svg]:invisible',
      )}
    >
      {isMixed ? <Minus /> : <Check />}
    </div>
  );
}
