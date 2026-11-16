/* eslint-disable react-refresh/only-export-components */
import {type VariantProps, cva} from 'class-variance-authority';
import type * as React from 'react';

import {cn} from '@/utils/cn';

// A leading 16px icon takes the first column when there is one; an action sits under the text, and to its
// right from `sm` up.
const alertVariants = cva(
  'grid w-full grid-cols-[0_minmax(0,1fr)] items-start gap-y-0.5 rounded-md border px-3 py-2.5 text-sm has-[>svg]:grid-cols-[1rem_minmax(0,1fr)] has-[>svg]:gap-x-3 sm:has-data-[slot=alert-action]:grid-cols-[0_minmax(0,1fr)_auto] sm:has-data-[slot=alert-action]:has-[>svg]:grid-cols-[1rem_minmax(0,1fr)_auto] [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground [&>svg]:text-muted-foreground',
        warning: 'border-warning/40 bg-warning/5 [&>svg]:text-warning',
        destructive: 'border-destructive/40 bg-destructive/5 [&>svg]:text-destructive',
      },
    },
    defaultVariants: {variant: 'default'},
  },
);

type AlertProps = React.ComponentProps<'div'> & VariantProps<typeof alertVariants>;

/**
 * An inline callout: a bordered block with an optional leading icon, a title, a description and an action. It has
 * no live-region role of its own: pass `role='alert'` for a message that appears in answer to something the owner
 * did, `role='status'` for a quieter update, and nothing for a notice that is there from the start.
 */
function Alert({className, variant, ...props}: AlertProps) {
  return <div data-slot='alert' className={cn(alertVariants({variant}), className)} {...props} />;
}

function AlertTitle({className, ...props}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='alert-title'
      className={cn('col-start-2 leading-snug font-medium text-pretty wrap-anywhere', className)}
      {...props}
    />
  );
}

function AlertDescription({className, ...props}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='alert-description'
      className={cn(
        'col-start-2 max-w-[60ch] text-pretty wrap-anywhere text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

/** Buttons for the alert: under its text on phones, beside it from `sm` up. */
function AlertAction({className, ...props}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='alert-action'
      className={cn(
        'col-start-2 mt-2 flex flex-wrap gap-2 sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:self-center',
        className,
      )}
      {...props}
    />
  );
}

export {Alert, AlertAction, AlertDescription, AlertTitle, alertVariants};
