import type {Account} from '@tempo/contracts';
import {Check, Search} from 'lucide-react';
import {useMemo, useState} from 'react';

import {PendingLabel} from '@/components/shared/pending-label';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';
import {ScrollArea} from '@/components/ui/scroll-area';
import {cn} from '@/utils/cn';

import {useUpdateTimeZone} from '../api/use-patch-account';
import {matchesTimeZone, timeZoneOptions} from '../utils/time-zones';

const ROW =
  'grid min-h-12 w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60';

type TimeZoneDialogProps = {
  currentTimeZone: Account['timeZone'];
};

/** Picks the account's time zone from a searchable list; choosing one saves it and closes the sheet. */
export function TimeZoneDialog({currentTimeZone}: TimeZoneDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const {updateTimeZone, isPending} = useUpdateTimeZone();
  // Offsets are read when the sheet opens, so they match today's daylight saving time.
  const options = useMemo(
    () => (isOpen ? timeZoneOptions(currentTimeZone) : []),
    [currentTimeZone, isOpen],
  );
  const shown = options.filter((option) => matchesTimeZone(option, query));

  const handleOpenChange = (open: boolean) => {
    if (open) setQuery('');
    setIsOpen(open);
  };

  // Open on the current zone, not the search field: phones keep the keyboard closed until it is tapped.
  const focusCurrent = (event: Event) => {
    event.preventDefault();
    const current = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
      '[aria-current="true"]',
    );
    current?.focus({preventScroll: true});
    current?.scrollIntoView({block: 'center'});
  };

  const choose = async (timeZone: string) => {
    if (timeZone === currentTimeZone) {
      setIsOpen(false);
      return;
    }
    setSaving(timeZone);
    try {
      await updateTimeZone(timeZone);
      setIsOpen(false);
    } catch {
      // The toast reports the failure; keep the list open so the owner can try again.
    } finally {
      setSaving(null);
    }
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={handleOpenChange}>
      <ResponsiveDialogTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className='min-w-20 max-sm:h-11'
          aria-label='Edit time zone'
          data-testid='edit-time-zone-button'
        >
          Edit
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className='grid-cols-1 sm:max-w-lg' onOpenAutoFocus={focusCurrent}>
        <ResponsiveDialogHeader className='px-4 text-start md:px-0'>
          <ResponsiveDialogTitle>Time zone</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Alerts that would arrive between 21:00 and 09:00 here wait until 09:00.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className='flex h-[min(60dvh,28rem)] min-h-0 flex-col px-4 pb-4 md:px-0 md:pb-0'>
          <label className='relative mb-2 block'>
            <span className='sr-only'>Search time zones</span>
            <Search
              aria-hidden='true'
              className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground'
            />
            <Input
              type='search'
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='Search by city or region'
              autoComplete='off'
              enterKeyHint='search'
              className='h-11 pl-9'
              data-testid='time-zone-search'
            />
          </label>
          <ScrollArea type='auto' className='-mx-2 min-h-0 flex-1'>
            {shown.length === 0 ? (
              <p className='px-4 py-8 text-center text-sm text-muted-foreground'>
                No time zone called “{query}”
              </p>
            ) : (
              // Clear of the scrollbar on the right, so it never touches a row.
              <ul className='grid pr-5 pl-2' aria-label='Time zones'>
                {shown.map((option) => {
                  const isCurrent = option.value === currentTimeZone;
                  return (
                    <li key={option.value}>
                      <button
                        type='button'
                        className={cn(ROW, isCurrent && 'bg-accent/60')}
                        aria-current={isCurrent || undefined}
                        disabled={isPending}
                        onClick={() => void choose(option.value)}
                      >
                        <span aria-hidden='true'>{isCurrent && <Check className='size-4' />}</span>
                        <span className='min-w-0 truncate'>{option.label}</span>
                        <span className='numeric text-xs text-muted-foreground'>
                          {saving === option.value ? (
                            <PendingLabel>Saving…</PendingLabel>
                          ) : (
                            option.offset
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
