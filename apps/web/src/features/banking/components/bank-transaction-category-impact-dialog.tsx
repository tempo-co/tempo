import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import {
  BankTransaction,
  BankTransactionCategory,
  BankTransactionCategoryImpact,
} from '@tempo/contracts';
import {ArrowRight, Check, ChevronDown, Minus, Sparkles} from 'lucide-react';
import {useId, useMemo, useState} from 'react';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {PendingLabel} from '@/components/shared/pending-label';
import {TextAction} from '@/components/shared/text-action';
import {Button} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {ScrollArea} from '@/components/ui/scroll-area';
import {cn} from '@/utils/cn';
import {formatCurrency} from '@/utils/format-currency';

import {
  formatBankTransactionCategory,
  formatBankTransactionDate,
  toBankTransactionCategory,
} from '../utils/formatters';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';
import {MerchantLogoTile} from './merchant-logo-tile';

type ImpactRow = BankTransactionCategoryImpact['transactions'][number];

type BankTransactionCategoryImpactDialogProps = {
  /** The transaction being corrected, before the correction is saved. */
  transaction: Pick<BankTransaction, 'displayDescription' | 'category' | 'merchantLogoUrl'>;
  category: BankTransactionCategory;
  impact: BankTransactionCategoryImpact;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (selectedIds: string[]) => void;
};

// Each row's checkbox and disclosure draw their own focus outline, so the row only takes the hover wash.
const ROW_INTERACTION = 'hover:bg-accent/60';

const rowDate = (row: ImpactRow) =>
  formatBankTransactionDate(row.transactionDate ?? row.bookingDate);

function Checkbox({
  id,
  checked,
  onCheckedChange,
  label,
}: {
  id?: string;
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <CheckboxPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={(value) => onCheckedChange(value === true)}
      aria-label={label}
      className='peer h-4 w-4 shrink-0 rounded-sm border border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground'
    >
      <CheckboxPrimitive.Indicator className='flex items-center justify-center text-current'>
        {checked === 'indeterminate' ? (
          <Minus className='h-4 w-4' />
        ) : (
          <Check className='h-4 w-4' />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** A category's 20px icon and name, the size used beside category names across the app. */
function CategoryChip({category}: {category: string | null}) {
  return (
    <span className='inline-flex min-w-0 items-center gap-1.5 text-body font-medium text-foreground'>
      <BankTransactionCategoryIcon
        category={toBankTransactionCategory(category)}
        className='size-5'
        iconClassName='size-3'
        data-testid='category-icon'
      />
      <span className='min-w-0 wrap-anywhere'>{formatBankTransactionCategory(category)}</span>
    </span>
  );
}

function RecheckChip() {
  return (
    <span className='inline-flex items-center gap-1.5 text-body font-medium text-foreground'>
      <span
        aria-hidden='true'
        data-testid='category-icon'
        className='inline-flex size-5 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground'
      >
        <Sparkles className='size-3' strokeWidth={1.8} />
      </span>
      AI picks again
    </span>
  );
}

/**
 * "Shopping → Travel". The arrow stays with the target, so a wrapped swap reads "Shopping" / "→ Travel".
 * An AI re-check has no known target, so it shows no arrow: "Shopping · AI picks again".
 */
function Swap({from, to}: {from: string | null; to: BankTransactionCategory | null}) {
  return (
    <span className='inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
      <CategoryChip category={from} />
      {to ? (
        <span className='inline-flex min-w-0 items-center gap-2'>
          <ArrowRight aria-hidden='true' className='size-4 shrink-0 text-muted-foreground' />
          <CategoryChip category={to} />
        </span>
      ) : (
        <span className='inline-flex min-w-0 items-center gap-2'>
          <span aria-hidden='true' className='text-muted-foreground'>
            ·
          </span>
          <RecheckChip />
        </span>
      )}
    </span>
  );
}

function SwapGroup({
  from,
  to,
  rows,
  selected,
  noun,
  logoUrl,
  onToggle,
}: {
  from: string | null;
  /** Null for an AI re-check, whose outcome is unknown. */
  to: BankTransactionCategory | null;
  rows: ImpactRow[];
  selected: Set<string>;
  noun: (count: number) => string;
  logoUrl: string | null;
  onToggle: (ids: string[], selected: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const checkboxId = useId();
  const ticked = rows.filter(({id}) => selected.has(id)).length;
  const state = ticked === rows.length ? true : ticked === 0 ? false : 'indeterminate';
  const fromLabel = formatBankTransactionCategory(from);
  const toLabel = to ? formatBankTransactionCategory(to) : 'AI picks again';
  const ids = rows.map(({id}) => id);

  return (
    <li className='overflow-hidden rounded-md border'>
      <div
        className={cn(
          // On phones the count sits under the swap, so the swap keeps the row's full width.
          'grid min-h-15 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 px-3 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]',
          ROW_INTERACTION,
        )}
      >
        <Checkbox
          id={checkboxId}
          checked={state}
          onCheckedChange={(on) => onToggle(ids, on)}
          label={`${fromLabel} to ${toLabel}`}
        />
        <label
          htmlFor={checkboxId}
          className='flex min-w-0 cursor-pointer items-center self-stretch'
        >
          <Swap from={from} to={to} />
        </label>
        <TextAction
          className='text-muted-foreground hover:text-foreground max-sm:col-start-2 max-sm:-ml-2 sm:-mr-2'
          aria-expanded={open}
          aria-label={`${rows.length} ${fromLabel} ${noun(rows.length)}`}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown
            aria-hidden='true'
            className={cn(
              'size-4 transition-transform motion-reduce:transition-none',
              open && 'rotate-180',
            )}
          />
          <span>
            <span className='numeric'>
              {ticked === rows.length ? rows.length : `${ticked} of ${rows.length}`}
            </span>
            <span> {noun(rows.length)}</span>
          </span>
        </TextAction>
      </div>
      {open && (
        <ul className='divide-y border-t'>
          {rows.map((row) => (
            <li key={row.id}>
              <label
                className={cn(
                  'grid min-h-15 cursor-pointer grid-cols-[auto_2.25rem_minmax(0,1fr)] items-center gap-3 px-3 py-2',
                  ROW_INTERACTION,
                )}
              >
                <Checkbox
                  checked={selected.has(row.id)}
                  onCheckedChange={(on) => onToggle([row.id], on)}
                  label={`${row.displayDescription}, ${rowDate(row)}, ${formatCurrency(Number(row.amount), row.currency)}`}
                />
                <MerchantLogoTile
                  transaction={{
                    merchantLogoUrl: logoUrl,
                    category: row.category,
                    cashFlowTreatment: 'EXPENSE',
                  }}
                />
                {/* The amount shares the name's line, so the date below always has the full width. */}
                <span className='min-w-0'>
                  <span className='flex flex-wrap items-baseline justify-between gap-x-3 text-body'>
                    {/* Wraps in full: these rows don't open, and a name's end can be what tells two apart. */}
                    <span className='min-w-0 wrap-anywhere'>{row.displayDescription}</span>
                    {/* An amount wider than the row breaks rather than running past its edge. */}
                    <span className='max-w-full min-w-0 [&>span]:wrap-anywhere [&>span]:whitespace-normal'>
                      <CurrencyAmount amount={Number(row.amount)} currency={row.currency} />
                    </span>
                  </span>
                  <span className='block text-xs whitespace-nowrap text-muted-foreground'>
                    {rowDate(row)}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function BankTransactionCategoryImpactDialog({
  transaction,
  category,
  impact,
  isPending,
  onCancel,
  onConfirm,
}: BankTransactionCategoryImpactDialogProps) {
  // Held from opening: the saved transaction reaches the cache before the dialog closes.
  const [from] = useState(transaction.category);
  const rows = impact.transactions;
  const [selected, setSelected] = useState(() => new Set(rows.map(({id}) => id)));
  const groups = useMemo(() => {
    const byFrom = new Map<string | null, ImpactRow[]>();
    for (const row of rows) byFrom.set(row.category, [...(byFrom.get(row.category) ?? []), row]);
    return [...byFrom.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [rows]);
  const toggle = (ids: string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const recheck = impact.action === 'RECHECK';
  // The server decides what the other rows get; it can differ from the category just picked.
  const applied = impact.category ?? category;
  const target = formatBankTransactionCategory(applied);
  // Rows match by merchant, not by text, so name it only when every row reads the same.
  const sameName = rows.every((row) => row.displayDescription === transaction.displayDescription);
  const name = sameName ? transaction.displayDescription : 'matching';
  const word = rows.every((row) => Number(row.amount) < 0) ? 'payment' : 'transaction';
  const noun = (count: number) => (count === 1 ? word : `${word}s`);
  const shown = rows.length;
  const capped = impact.total > shown;
  const others = capped ? `the newest ${shown} of ${impact.total}` : `${shown}`;
  const count = selected.size;
  const all = count === shown;
  const scope = capped ? 'newest' : 'all';

  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && !isPending && onCancel()}>
      <ResponsiveDialogContent
        data-testid='category-impact-dialog'
        className='flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 md:max-w-xl'
      >
        {/* Header and list scroll as one, so a long name or a short screen never squeezes the list out. */}
        <ScrollArea
          type='auto'
          data-testid='category-impact-body'
          className='grid min-h-0 grid-rows-[minmax(0,1fr)] [&_[data-radix-scroll-area-viewport]>div]:block! [&>[data-radix-scroll-area-viewport]]:min-h-0 [&>[data-radix-scroll-area-viewport]]:overscroll-contain'
        >
          <ResponsiveDialogHeader className='border-b p-5 text-left md:pr-12'>
            <ResponsiveDialogTitle className='wrap-anywhere'>
              {recheck
                ? `Let AI re-check ${others} other ${sameName ? `${name} ` : ''}${noun(shown)}?`
                : `Move other ${name} ${noun(2)} to ${target} too?`}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className='flex flex-wrap items-center gap-x-2 gap-y-1 pt-2'>
              <span>This {noun(1)} moves</span>
              <Swap from={from} to={category} />
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className='p-5'>
            <p className='mb-3 text-body-small wrap-anywhere text-muted-foreground'>
              {recheck
                ? 'Each can end up in a different category.'
                : `${others.charAt(0).toUpperCase()}${others.slice(1)} other ${sameName ? `${name} ` : ''}${noun(shown)} can follow:`}
            </p>
            <fieldset disabled={isPending} className='min-w-0'>
              <legend className='sr-only'>Other {noun(2)} to change</legend>
              <ul className='space-y-2'>
                {groups.map(([from, groupRows]) => (
                  <SwapGroup
                    key={from ?? 'none'}
                    from={from}
                    to={recheck ? null : applied}
                    rows={groupRows}
                    selected={selected}
                    noun={noun}
                    logoUrl={transaction.merchantLogoUrl}
                    onToggle={toggle}
                  />
                ))}
              </ul>
            </fieldset>
            {capped && (
              <p className='mt-3 text-body-small text-muted-foreground'>
                The {impact.total - shown} older {noun(impact.total - shown)} stay as they are.
              </p>
            )}
          </div>
        </ScrollArea>
        <ResponsiveDialogFooter className='shrink-0 gap-2 border-t p-5'>
          <Button
            disabled={isPending || count === 0}
            // A long category name wraps on narrow phones instead of being cut off.
            className='h-auto min-h-10 py-2 text-center whitespace-normal md:order-3'
            onClick={() => onConfirm(rows.filter(({id}) => selected.has(id)).map(({id}) => id))}
          >
            {isPending ? (
              <PendingLabel>Saving…</PendingLabel>
            ) : recheck ? (
              all ? (
                `Re-check ${scope} ${count}`
              ) : (
                `Re-check ${count}`
              )
            ) : all ? (
              `Move ${scope} ${count} to ${target}`
            ) : (
              `Move ${count} to ${target}`
            )}
          </Button>
          <Button
            variant='outline'
            disabled={isPending}
            className='md:order-2'
            onClick={() => onConfirm([])}
          >
            Only this one
          </Button>
          <Button
            variant='ghost'
            disabled={isPending}
            className='md:order-1 md:mr-auto'
            onClick={onCancel}
          >
            Cancel
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
