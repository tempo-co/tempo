import {type ReactNode, useRef, useState} from 'react';

import {Tooltip, TooltipContent, TooltipPortal, TooltipTrigger} from '@/components/ui/tooltip';

/** Tips wrap rather than run off a phone screen, and sit above sticky table cells and dialogs. */
const TIP = 'max-w-[min(20rem,calc(100vw-2rem))] text-xs';

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

/**
 * Shows `tip` on hover and on focus of its only child, which must take focus (a link, or `tabIndex={0}`); without a
 * tip, the child alone.
 */
export function DataTip({tip, children}: {tip: ReactNode; children: ReactNode}) {
  if (!tip) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipPortal>
        <TooltipContent className={TIP}>{tip}</TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

/** A focus outline for a figure that takes focus only to show its tip. */
export const TIP_FOCUS = 'focus-visible:outline-2 focus-visible:outline-ring';
