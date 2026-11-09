import {type ReactElement, type ReactNode, useRef, useState} from 'react';

import {Tooltip, TooltipContent, TooltipPortal, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/utils/cn';

/** Tips wrap rather than run off a phone screen, and sit above sticky table cells and dialogs. */
const TIP_WIDTH = 'max-w-[min(20rem,calc(100vw-2rem))]';
const TIP = cn(TIP_WIDTH, 'text-xs');

/** A readout's own box: on the card colour, its one column no wider than the box. */
const READOUT =
  'grid min-w-48 grid-cols-1 gap-1 rounded-md border bg-card p-2.5 text-xs text-card-foreground shadow-sm';

/** Whether an element's text is cut off, by truncation or a line clamp. */
const isCut = (element: HTMLElement | null) =>
  !!element &&
  (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight);

/** A name that may be cut off; hovering it shows it whole, but only when it is cut. */
export function TruncatedText({children, className}: {children: string; className?: string}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={(next) => setOpen(next && isCut(ref.current))}>
      <TooltipTrigger asChild>
        <span ref={ref} className={className}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent className={TIP}>{children}</TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

/** A figure's tip: a {@link Readout}'s title and rows, and the sentence screen readers hear instead. */
export type ReadoutTip = {readout: ReactElement; label: string};

/**
 * Shows `tip` on hover and on focus of its only child, which must take focus (a link, or `tabIndex={0}`); without a
 * tip, the child alone. A string is one short sentence; a {@link ReadoutTip} shows as a readout.
 */
export function DataTip({tip, children}: {tip: string | ReadoutTip | false; children: ReactNode}) {
  if (!tip) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipPortal>
        {typeof tip === 'string' ? (
          <TooltipContent className={TIP}>{tip}</TooltipContent>
        ) : (
          <TooltipContent
            data-slot='readout'
            aria-label={tip.label}
            className={cn(READOUT, TIP_WIDTH)}
          >
            {tip.readout}
          </TooltipContent>
        )}
      </TooltipPortal>
    </Tooltip>
  );
}

/** A chart's readout box, the same as a figure's readout tip. */
export function Readout({children}: {children: ReactNode}) {
  return (
    <div data-slot='readout' className={READOUT}>
      {children}
    </div>
  );
}

/** A readout's title on one line: an optional icon, the name, cut short if it must be, then a muted note. */
export function ReadoutTitle({
  icon,
  note,
  children,
}: {
  icon?: ReactNode;
  note?: string;
  children: ReactNode;
}) {
  return (
    <p className='flex min-w-0 items-center gap-2 font-semibold whitespace-nowrap'>
      {icon}
      <span className='flex min-w-0 gap-1'>
        <span className='truncate'>{children}</span>
        {note && (
          <>
            {' '}
            <span className='shrink-0 font-normal text-muted-foreground'>· {note}</span>
          </>
        )}
      </span>
    </p>
  );
}

/** A readout row on one line: the label on the left, cut short if it must be, and the figure on the right. */
export function ReadoutRow({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <p className='flex items-center justify-between gap-4 whitespace-nowrap'>
      <span className='truncate text-muted-foreground'>{label}</span>
      <span
        className={cn(
          'shrink-0 numeric',
          strong && 'font-semibold',
          muted && 'text-muted-foreground',
        )}
      >
        {value}
      </span>
    </p>
  );
}

/** A focus outline for a figure that takes focus only to show its tip. */
export const TIP_FOCUS = 'focus-visible:outline-2 focus-visible:outline-ring';
