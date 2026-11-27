import type {
  BankTransactionBulkCategoryPreview,
  BankTransactionBulkCategoryScope,
  BankTransactionBulkSelection,
  BankTransactionCategory,
} from '@tempo/contracts';
import {CircleAlert} from 'lucide-react';
import {useEffect, useId, useRef, useState} from 'react';
import {toast} from 'sonner';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {PendingLabel} from '@/components/shared/pending-label';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
import {wasToasted} from '@/utils/api';

import {useUpdateBulkCategory} from '../api/use-bulk-category';
import {formatBankTransactionCategory, formatBankTransactionCompactDate} from '../utils/formatters';
import {MerchantLogoTile} from './merchant-logo-tile';

/** A category picked for the selected rows, with the other rows from their payees that could follow. */
export type BulkCategoryDraft = {
  /** The picked ids, or the list's filter when every matching row is picked. */
  selection: BankTransactionBulkSelection;
  category: BankTransactionCategory;
  preview: BankTransactionBulkCategoryPreview;
};

type PreviewRow = BankTransactionBulkCategoryPreview['transactions'][number];

/** Payees named by the rows that could follow: one or two by name, more as "these payees". */
function payeesOf(rows: PreviewRow[]) {
  const names = [...new Set(rows.map((row) => row.displayDescription))];
  return names.length <= 2 ? names.join(' and ') : 'these payees';
}

/**
 * "Change 3 to Eating out?": the step a bulk category takes, asked once in the rail (the phone sheet below `lg`). It
 * lists the other transactions from the same payees and offers Just these or Change all; the result shows as a toast.
 * Escape cancels it.
 */
export function BulkCategoryStep({
  draft: {selection, category, preview},
  onDone,
  onCancel,
}: {
  draft: BulkCategoryDraft;
  /** Called once the write is saved. */
  onDone: () => void;
  onCancel: () => void;
}) {
  const {updateBulkCategory, isPending} = useUpdateBulkCategory();
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<BankTransactionBulkCategoryScope | null>(null);
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus({preventScroll: true}), []);
  // Captured ahead of the sheet's own Escape, so Escape cancels the step; while the save runs it does nothing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      if (!isPending) onCancel();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isPending, onCancel]);

  const label = formatBankTransactionCategory(category);
  const selected = preview.selected;
  const rows = preview.transactions;
  const all = selected + rows.length;
  const older = preview.total - rows.length;

  const apply = async (scope: BankTransactionBulkCategoryScope) => {
    setFailed(false);
    setSaving(scope);
    try {
      const {updated} = await updateBulkCategory({...selection, category, scope});
      toast.success(`Changed ${updated} to ${label}`);
      onDone();
    } catch (error) {
      // The wrapper already said what went wrong (offline, signed out); the step stays for a retry.
      if (!wasToasted(error)) setFailed(true);
    } finally {
      setSaving(null);
    }
  };
  const busy = (scope: BankTransactionBulkCategoryScope) =>
    isPending && saving === scope ? <PendingLabel>Saving…</PendingLabel> : null;

  return (
    <section
      aria-labelledby={titleId}
      data-testid='bulk-category-step'
      className='flex min-h-0 flex-1 flex-col'
    >
      <ScrollArea
        type='auto'
        className='grid min-h-0 grid-rows-[minmax(0,1fr)] [&_[data-radix-scroll-area-viewport]>div]:block! [&>[data-radix-scroll-area-viewport]]:min-h-0 [&>[data-radix-scroll-area-viewport]]:overscroll-contain'
      >
        <header className='grid gap-1 border-b p-5'>
          <h2
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            className='text-section-title wrap-anywhere focus-visible:outline-none'
          >
            <span>
              Change <span className='numeric'>{selected}</span>
            </span>{' '}
            to {label}?
          </h2>
          <p className='text-body-small wrap-anywhere text-muted-foreground'>
            {rows.length > 0
              ? `${preview.total} more from ${payeesOf(rows)} can change too:`
              : 'No other transactions from these payees.'}
          </p>
        </header>
        {rows.length > 0 && (
          <div className='p-5 pt-3'>
            <ul aria-label='Other transactions from these payees' className='divide-y'>
              {rows.map((row) => (
                <li
                  key={row.id}
                  className='grid min-h-15 grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 py-2'
                >
                  <MerchantLogoTile
                    transaction={{
                      merchantLogoUrl: null,
                      category: row.category,
                      cashFlowTreatment: Number(row.amount) < 0 ? 'EXPENSE' : 'INCOME',
                    }}
                  />
                  {/* The amount shares the name's line and drops below it when both don't fit. */}
                  <span className='min-w-0'>
                    <span className='flex flex-wrap items-baseline justify-between gap-x-3 text-body'>
                      {/* Wraps in full: these rows don't open, and a name's end can tell two apart. */}
                      <span className='min-w-0 wrap-anywhere'>{row.displayDescription}</span>
                      <span className='whitespace-nowrap'>
                        <CurrencyAmount amount={Number(row.amount)} currency={row.currency} />
                      </span>
                    </span>
                    <span className='block text-body-small text-muted-foreground'>
                      {formatBankTransactionCompactDate(row.transactionDate ?? row.bookingDate)} ·{' '}
                      {formatBankTransactionCategory(row.category)}
                      {row.action === 'RECHECK' && ' · AI picks again'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {older > 0 && (
              <p className='mt-3 text-body-small text-muted-foreground'>
                The {older} older ones stay as they are.
              </p>
            )}
          </div>
        )}
      </ScrollArea>
      <footer className='grid shrink-0 gap-2 border-t p-5'>
        {failed && (
          <Alert variant='destructive' role='alert'>
            <CircleAlert aria-hidden='true' />
            <AlertTitle>Categories couldn’t be saved</AlertTitle>
            <AlertDescription>Nothing changed. Try again.</AlertDescription>
          </Alert>
        )}
        {rows.length > 0 ? (
          <div className='grid grid-cols-2 gap-2'>
            <Button variant='outline' disabled={isPending} onClick={() => void apply('SELECTED')}>
              {/* One span, so the button's icon gap doesn't open between the words and the count. */}
              {busy('SELECTED') ?? (
                <span>
                  Just these <span className='numeric'>{selected}</span>
                </span>
              )}
            </Button>
            <Button disabled={isPending} onClick={() => void apply('ALL')}>
              {busy('ALL') ?? (
                <span>
                  Change all <span className='numeric'>{all}</span>
                </span>
              )}
            </Button>
          </div>
        ) : (
          <Button disabled={isPending} onClick={() => void apply('SELECTED')}>
            {busy('SELECTED') ?? (
              <span>
                Change <span className='numeric'>{selected}</span>
              </span>
            )}
          </Button>
        )}
        <Button variant='ghost' disabled={isPending} onClick={onCancel}>
          Cancel
        </Button>
      </footer>
    </section>
  );
}
