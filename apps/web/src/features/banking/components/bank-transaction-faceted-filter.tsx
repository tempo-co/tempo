import {ChevronDown} from 'lucide-react';
import * as React from 'react';

import {Button} from '@/components/ui/button';
import {CommandGroup, CommandItem, CommandSeparator} from '@/components/ui/command';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {cn} from '@/utils/cn';

import {BankTransactionFilterSection} from './bank-transaction-filter-section';

type FacetedFilterProps = {
  variant: 'popover' | 'mobile';
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
  /** Shown in the phone filter sheet instead of `children`, which then only fill the popover. */
  mobileContent?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * The frame every transaction filter shares: a labelled section in the phone filter sheet, or an
 * outline trigger with a popover on larger screens.
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
  mobileContent,
  children,
}: FacetedFilterProps) {
  if (variant === 'mobile') {
    return (
      <BankTransactionFilterSection label={label}>
        {mobileContent ?? (
          <div className='overflow-hidden rounded-md border bg-background'>{children}</div>
        )}
      </BankTransactionFilterSection>
    );
  }

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

/** The Reset row at the end of a filter's command list, shown while the filter has a value. */
export function FilterResetGroup({show, onReset}: {show: boolean; onReset: () => void}) {
  if (!show) return null;

  return (
    <>
      <CommandSeparator />
      <CommandGroup>
        <CommandItem onSelect={onReset} className='justify-center text-center'>
          Reset
        </CommandItem>
      </CommandGroup>
    </>
  );
}
