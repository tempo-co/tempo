import type {CashFlowInterval} from '@tempo/contracts';

import {Button} from '@/components/ui/button';

import {IntervalToggle} from './interval-toggle';

type ChartCardHeaderProps = {
  title: string;
  interval: CashFlowInterval;
  onIntervalChange: (interval: CashFlowInterval) => void;
  toggleLabel: string;
  /** The summary under the title row, spanning the card. */
  children?: React.ReactNode;
};

/** The title and interval switch share the first row; the summary spans the card below them. */
export function ChartCardHeader({
  title,
  interval,
  onIntervalChange,
  toggleLabel,
  children,
}: ChartCardHeaderProps) {
  return (
    <header className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2.5'>
      <h2 className='text-card-title'>{title}</h2>
      {/* Overhangs the title row so the title sits where it does on every other card. */}
      <div className='-my-1.5 max-sm:-my-2.5 pointer-coarse:-my-2.5'>
        <IntervalToggle value={interval} onChange={onIntervalChange} label={toggleLabel} />
      </div>
      {children}
    </header>
  );
}

export function ChartCardError({message, onRetry}: {message: string; onRetry: () => unknown}) {
  return (
    <div className='grid justify-items-start gap-3'>
      <p className='text-sm'>{message}</p>
      <Button variant='outline' size='sm' onClick={() => void onRetry()}>
        Try again
      </Button>
    </div>
  );
}
