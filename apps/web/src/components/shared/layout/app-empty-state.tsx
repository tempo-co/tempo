import * as React from 'react';

import {cn} from '@/utils/cn';

type EmptyStateProps = {
  title: string;
  description: string;
  icon: React.ElementType;
  /** `error` marks a failed load: the icon takes the destructive colour. */
  tone?: 'empty' | 'error';
  /** Drop the card frame where the state already sits on a surface, such as a dialog. */
  framed?: boolean;
  children?: React.ReactNode;
};

export function EmptyState({
  title,
  description,
  icon: Icon,
  tone = 'empty',
  framed = true,
  children,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center px-6 text-center',
        framed ? 'rounded-card border bg-card py-16' : 'py-10',
      )}
    >
      <Icon
        aria-hidden='true'
        className={cn(
          'mb-5 h-12 w-12',
          tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
        )}
      />
      <h2 className='text-section-title'>{title}</h2>
      <p className='mt-2 max-w-md text-sm text-muted-foreground'>{description}</p>
      {children ? <div className='mt-6 flex flex-wrap justify-center gap-3'>{children}</div> : null}
    </div>
  );
}
