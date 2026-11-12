import {ChevronDown} from 'lucide-react';
import * as React from 'react';

import {Button} from '@/components/ui/button';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {cn} from '@/utils/cn';

type FacetedFilterProps = {
  variant: 'popover' | 'pane';
  label: string;
  icon: React.ReactNode;
  /** A filter with a value gets a solid border; an empty one a dashed border. */
  isActive: boolean;
  /** What the trigger shows after the label, usually a `SelectedFilterSummary`. */
  summary?: React.ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  contentClassName: string;
  className?: string;
  onOpenChange?: (open: boolean) => void;
  /** Shown in the Filters panel instead of `children`, which then only fill the popover. */
  paneContent?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * A filter's own toolbar control: an outline trigger with a popover, or (`pane`) just the options, for the Filters
 * panel, which shows one filter at a time and scrolls it itself. The Booking date filter is the one that needs both.
 */
export function FacetedFilter({
  variant,
  label,
  icon,
  isActive,
  summary,
  ariaLabel,
  disabled = false,
  contentClassName,
  className,
  onOpenChange,
  paneContent,
  children,
}: FacetedFilterProps) {
  if (variant === 'pane') return <>{paneContent ?? children}</>;

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            'h-12 sm:h-8',
            isActive || disabled ? 'border' : 'border-dashed',
            disabled && 'cursor-not-allowed opacity-50',
            className,
          )}
        >
          {icon}
          {label}
          {summary}
          <ChevronDown className='text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={contentClassName} align='start'>
        {children}
      </PopoverContent>
    </Popover>
  );
}
