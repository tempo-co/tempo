import type {ReportingCurrency} from '@tempo/contracts';
import {useState} from 'react';

import {PendingLabel} from '@/components/shared/pending-label';
import {Button} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';

import {useChooseReportingCurrency} from '../api/use-choose-reporting-currency';
import {CurrencyList} from './currency-list';

/** Changes the reporting currency: pick one, then Save. Nothing is saved on picking alone. */
export function ReportingCurrencyDialog({settings}: {settings: ReportingCurrency}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(settings.currency);
  const {choose, isPending} = useChooseReportingCurrency();
  const changes = selected !== null && selected !== settings.currency;

  // Start from the saved currency every time, never from an abandoned pick.
  const handleOpenChange = (open: boolean) => {
    if (open) setSelected(settings.currency);
    setIsOpen(open);
  };

  const save = async () => {
    if (!selected) return;
    if (!changes && settings.confirmed) {
      setIsOpen(false);
      return;
    }
    try {
      await choose(selected);
      setIsOpen(false);
    } catch {
      // The toast reports the failure; keep the dialog open so the pick is not lost.
    }
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={handleOpenChange}>
      <ResponsiveDialogTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className='min-w-20 max-sm:h-11'
          aria-label='Edit reporting currency'
          data-testid='edit-reporting-currency-button'
        >
          Edit
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className='grid-cols-1 sm:max-w-lg'>
        <ResponsiveDialogHeader className='px-4 text-start md:px-0'>
          <ResponsiveDialogTitle>Reporting currency</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Totals and charts add amounts up in this currency. Each account and transaction keeps
            its own.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className='flex h-[min(52dvh,24rem)] min-h-0 flex-col px-4 md:px-0'>
          <CurrencyList
            settings={settings}
            value={selected}
            onSelect={setSelected}
            disabled={isPending}
          />
        </div>
        <p className='min-h-5 px-4 text-sm text-muted-foreground md:px-0' aria-live='polite'>
          {selected === null
            ? 'Choose a currency before saving.'
            : changes
              ? 'Totals are recalculated in the new currency, which can take a minute.'
              : null}
        </p>
        <ResponsiveDialogFooter className='gap-2'>
          <Button
            type='button'
            onClick={() => void save()}
            disabled={isPending || selected === null}
            className='md:order-2'
            data-testid='save-reporting-currency-button'
          >
            {isPending ? <PendingLabel>Saving…</PendingLabel> : 'Save'}
          </Button>
          <ResponsiveDialogClose asChild>
            <Button variant='outline' type='button' className='md:order-1'>
              {isPending ? 'Close' : 'Cancel'}
            </Button>
          </ResponsiveDialogClose>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
