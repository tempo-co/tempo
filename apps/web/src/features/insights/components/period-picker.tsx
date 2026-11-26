import {useEffect, useRef} from 'react';

import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';

import type {PeriodOption} from '../utils/insights-period';

/**
 * The one period every figure on Insights covers: the spans, each calendar year with history, and All. It scrolls
 * sideways when the years outgrow the column.
 */
export function PeriodPicker({
  options,
  value,
  onChange,
}: {
  options: PeriodOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // A chosen year or All past the column's edge scrolls into sight, also once the history adds its years.
  useEffect(() => {
    ref.current
      ?.querySelector('[data-state="on"]')
      ?.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }, [value, options.length]);
  return (
    <div ref={ref} className='-mx-4 [scrollbar-width:none] overflow-x-auto px-4'>
      <ToggleGroup
        type='single'
        value={value}
        onValueChange={(next) => {
          // Pressing the chosen period again leaves it chosen.
          if (next) onChange(next);
        }}
        aria-label='Period'
        className='w-max justify-start gap-0 overflow-hidden rounded-md border'
      >
        {options.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            className='h-auto min-h-11 min-w-11 shrink-0 rounded-none px-3 font-normal whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-muted-foreground focus-visible:-outline-offset-2 data-[state=on]:bg-foreground data-[state=on]:font-medium data-[state=on]:text-background data-[state=on]:hover:bg-foreground data-[state=on]:hover:text-background sm:min-h-8'
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
