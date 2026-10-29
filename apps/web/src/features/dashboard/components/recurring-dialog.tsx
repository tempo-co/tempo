import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogCornerClose,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {ScrollArea} from '@/components/ui/scroll-area';
import {RecurringSeriesOverview} from '@/features/banking/components/recurring-series-overview';
import {useLocalDate} from '@/hooks/use-local-date';

/** Every recurring bill and income stream, over Home. */
export function RecurringDialog({
  open,
  onOpenChange,
  selectedKey,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedKey: string | null;
  onSelect: (seriesKey: string | null) => void;
}) {
  const asOf = useLocalDate();
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        aria-label='Recurring payments'
        className='flex h-[min(90dvh,56rem)] max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-h-[90vh] sm:max-w-3xl [&>button:last-child]:hidden'
      >
        <ResponsiveDialogCornerClose label='Close recurring payments' />
        <ResponsiveDialogHeader className='shrink-0 border-b px-5 pt-5 pr-16 pb-4 text-left sm:px-6'>
          <ResponsiveDialogTitle className='text-xl leading-tight sm:text-2xl sm:leading-8'>
            Recurring payments
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='mt-1 md:mt-0'>
            Bills and income found in your history.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {/* Radix wraps content in a display:table div that grows to its widest row; keep it at the sheet's width. */}
        <ScrollArea
          type='always'
          className='min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block'
        >
          <div className='p-5 sm:p-6'>
            {open && (
              <RecurringSeriesOverview asOf={asOf} selectedKey={selectedKey} onSelect={onSelect} />
            )}
          </div>
        </ScrollArea>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
