import type {ReportingCurrency} from '@tempo/contracts';
import {ChevronDown, RefreshCw} from 'lucide-react';
import {useId, useState} from 'react';

import {PendingLabel} from '@/components/shared/pending-label';
import {StateMessage} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';
import {cn} from '@/utils/cn';

import {useChooseReportingCurrency} from '../api/use-choose-reporting-currency';
import {useReportingCurrency} from '../api/use-reporting-currency';
import {currencyLabel} from '../utils/currency-names';
import {CurrencyList} from './currency-list';

/** `EUR`, `EUR and GBP`, `CHF, EUR and GBP`. */
const codeList = (codes: string[]) =>
  codes.length < 2
    ? codes.join('')
    : `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}`;

/** The one-time question which currency totals use, while the owner's accounts hold several and none is chosen. */
export function ReportingCurrencySetup({className}: {className?: string}) {
  const {data: settings} = useReportingCurrency();
  if (!settings?.setupRequired) return null;
  return <SetupCard settings={settings} className={className} />;
}

function SetupCard({settings, className}: {settings: ReportingCurrency; className?: string}) {
  const headingId = useId();
  const hintId = useId();
  // What the owner picked; until they touch the picker, the saved or suggested currency, which a refetch may change.
  const [picked, setPicked] = useState<{value: string | null} | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const {choose, isPending} = useChooseReportingCurrency();
  const selected = picked ? picked.value : (settings.currency ?? settings.suggestion);
  const suggested =
    selected !== null && settings.currency === null && selected === settings.suggestion;

  const openPicker = () => {
    setPicked((current) => current ?? {value: selected});
    setPickerOpen(true);
  };

  const save = async () => {
    if (!selected) {
      openPicker();
      return;
    }
    try {
      await choose(selected);
    } catch {
      // The toast reports the failure; the choice stays so the owner can try again.
    }
  };

  const hint =
    selected === null
      ? 'Choose a currency before saving.'
      : suggested
        ? 'Suggested from your recent transactions.'
        : null;

  return (
    <section
      aria-labelledby={headingId}
      className={cn('grid gap-4 rounded-card border bg-card p-5 sm:p-6', className)}
      data-testid='reporting-currency-setup'
    >
      <div className='grid gap-1'>
        <h2 id={headingId} className='text-card-title text-balance'>
          Which currency should Tempo use for totals?
        </h2>
        <p className='text-sm text-muted-foreground'>
          Your accounts are in {codeList(settings.connectedCurrencies)}. Totals and charts add them
          up in one currency; each account and transaction keeps its own.
        </p>
      </div>
      <div className='grid gap-2'>
        <div className='flex flex-wrap items-center gap-2 max-sm:grid'>
          <ResponsiveDialog
            open={pickerOpen}
            onOpenChange={(open) => (open ? openPicker() : setPickerOpen(false))}
          >
            <ResponsiveDialogTrigger asChild>
              <Button
                variant='outline'
                className='justify-between sm:min-w-64'
                aria-describedby={hint ? hintId : undefined}
                disabled={isPending}
                data-testid='reporting-currency-picker'
              >
                <span className='min-w-0 truncate'>
                  {selected ? currencyLabel(selected) : 'Choose a currency'}
                </span>
                <ChevronDown aria-hidden='true' className='text-muted-foreground' />
              </Button>
            </ResponsiveDialogTrigger>
            <ResponsiveDialogContent className='grid-cols-1 sm:max-w-lg'>
              <ResponsiveDialogHeader className='px-4 text-start md:px-0'>
                <ResponsiveDialogTitle>Currency for totals</ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  Your accounts&apos; currencies come first.
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <div className='flex h-[min(60dvh,28rem)] min-h-0 flex-col px-4 pb-4 md:px-0 md:pb-0'>
                <CurrencyList
                  settings={settings}
                  value={selected}
                  onSelect={(currency) => {
                    setPicked({value: currency});
                    setPickerOpen(false);
                  }}
                />
              </div>
            </ResponsiveDialogContent>
          </ResponsiveDialog>
          <Button
            onClick={() => void save()}
            disabled={isPending}
            data-testid='reporting-currency-save'
          >
            {isPending ? (
              <PendingLabel>Saving…</PendingLabel>
            ) : selected ? (
              `Use ${selected}`
            ) : (
              'Save'
            )}
          </Button>
        </div>
        {hint && (
          <p id={hintId} className='text-sm text-muted-foreground'>
            {hint}
          </p>
        )}
      </div>
    </section>
  );
}

/** Stands in for combined figures while their amounts are converted into a newly chosen currency. */
export function RecalculatingTotals({currency}: {currency: string | null}) {
  return (
    <StateMessage
      icon={RefreshCw}
      title={currency ? `Recalculating totals in ${currency}` : 'Recalculating totals'}
      description='Amounts are being converted, which can take a minute. Your accounts and transactions stay as they are.'
    />
  );
}
