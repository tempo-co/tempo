import type {CashFlowInterval} from '@tempo/contracts';

import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';

const INTERVALS: {value: CashFlowInterval; label: string}[] = [
  {value: 'week', label: 'Week'},
  {value: 'month', label: 'Month'},
  {value: 'year', label: 'Year'},
];

/** The Week · Month · Year switch shared by the Home charts. */
export function IntervalToggle({
  value,
  onChange,
  label,
}: {
  value: CashFlowInterval;
  onChange: (value: CashFlowInterval) => void;
  label: string;
}) {
  return (
    <ToggleGroup
      type='single'
      variant='outline'
      size='sm'
      value={value}
      onValueChange={(next) => {
        const item = INTERVALS.find((interval) => interval.value === next);
        if (item) onChange(item.value);
      }}
      aria-label={label}
    >
      {INTERVALS.map((item) => (
        <ToggleGroupItem
          key={item.value}
          value={item.value}
          className='min-h-9 touch-manipulation px-3 text-xs active:bg-accent data-[state=on]:bg-secondary data-[state=on]:font-semibold data-[state=on]:text-secondary-foreground max-sm:min-h-11 max-sm:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11'
        >
          {item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
