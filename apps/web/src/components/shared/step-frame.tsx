import {ArrowLeft} from 'lucide-react';
import type {ReactNode} from 'react';

import {Button} from '@/components/ui/button';
import {
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {ScrollArea} from '@/components/ui/scroll-area';
import {cn} from '@/utils/cn';

const FOOTER =
  'flex shrink-0 flex-col gap-2 border-t px-4 pt-4 pb-[calc(--spacing(4)+env(safe-area-inset-bottom))] md:mt-auto md:flex-row md:items-center md:justify-end md:px-6 md:pb-4';

/**
 * One step of a stepped sheet: its header with an optional way back, a body that scrolls on its own, and a footer
 * that stays in reach. A body with its own scrolling list (`scroll: false`) fills the space between them instead.
 */
export function StepFrame({
  title,
  description,
  srDescription,
  onBack,
  backLabel = 'Back',
  body,
  footer,
  scroll = true,
  truncateTitle = false,
  testId,
}: {
  title: string;
  /** One line, so a long name never makes the header taller; the body names it in full. */
  truncateTitle?: boolean;
  /** Shown under the title. */
  description?: string;
  /** Without a shown description, what assistive technology hears the sheet is for. */
  srDescription?: string;
  onBack?: () => void;
  backLabel?: string;
  body: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  testId?: string;
}) {
  // Without a footer, the body keeps clear of a phone's home indicator itself.
  const inset = cn(
    'px-4 md:px-6 md:pb-6',
    footer ? 'pb-4' : 'pb-[calc(--spacing(4)+env(safe-area-inset-bottom))]',
  );
  return (
    <>
      <ResponsiveDialogHeader className='shrink-0 grid-cols-[minmax(0,1fr)] px-4 pt-3 pb-4 text-start md:px-6'>
        <div className='flex min-h-11 items-center gap-1 md:pr-10'>
          {onBack && (
            <Button
              variant='ghost'
              size='icon'
              aria-label={backLabel}
              className='-ml-2 size-11'
              onClick={onBack}
            >
              <ArrowLeft />
            </Button>
          )}
          <ResponsiveDialogTitle
            className={cn('min-w-0', truncateTitle ? 'truncate' : 'wrap-anywhere')}
          >
            {title}
          </ResponsiveDialogTitle>
        </div>
        <ResponsiveDialogDescription className={description ? 'pt-1' : 'sr-only'}>
          {description ?? srDescription}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      {body &&
        (scroll ? (
          <ScrollArea
            type='auto'
            data-testid={testId}
            className='grid min-h-0 grid-rows-[minmax(0,1fr)] [&_[data-radix-scroll-area-viewport]>div]:block! [&>[data-radix-scroll-area-viewport]]:min-h-0 [&>[data-radix-scroll-area-viewport]]:overscroll-contain'
          >
            <div className={inset}>{body}</div>
          </ScrollArea>
        ) : (
          <div data-testid={testId} className={cn('flex min-h-0 flex-1 flex-col', inset)}>
            {body}
          </div>
        ))}
      {footer && <div className={FOOTER}>{footer}</div>}
    </>
  );
}
