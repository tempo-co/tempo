import {BANK_TRANSACTION_BULK_MAX_IDS, type BankTransactionCategory} from '@tempo/contracts';
import {Eye, EyeOff, Tag, X} from 'lucide-react';
import {type ReactNode, useState} from 'react';

import {PendingLabel} from '@/components/shared/pending-label';
import {Button} from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {ScrollArea} from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import {PICKABLE_CATEGORIES} from '../utils/bank-transaction-category-meta';
import {formatBankTransactionCategory} from '../utils/formatters';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';

/**
 * The bar under the list while rows are picked: "3 selected", a way to clear the selection, and the actions that
 * apply to every picked row. It sticks to the bottom of the view, above the phone tab bar.
 */
export function BankTransactionBulkBar({
  count,
  tooMany,
  onClear,
  children,
}: {
  count: number;
  /** More rows are picked one by one than an action takes; every row matching the filters has no limit. */
  tooMany: boolean;
  onClear: () => void;
  /** The bulk actions, each a button in the bar. */
  children: ReactNode;
}) {
  return (
    <div
      role='toolbar'
      aria-label='Selected transactions'
      data-testid='bank-transaction-bulk-bar'
      // Sticks above the phone tab bar (56px and its safe area) and clear of the page bottom on desktop.
      className='sticky bottom-4 z-10 mx-auto flex w-fit max-w-full min-w-0 items-center gap-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg max-md:bottom-[calc(--spacing(17)+env(safe-area-inset-bottom))]'
    >
      <Button
        variant='ghost'
        size='icon'
        aria-label='Clear the selection'
        onClick={onClear}
        className='shrink-0'
      >
        <X aria-hidden='true' />
      </Button>
      <p className='min-w-0 px-1 text-body-small font-medium' aria-live='polite'>
        <span className='whitespace-nowrap'>
          <span className='numeric'>{count}</span> selected
        </span>
        {/* On its own line, so a narrow bar keeps its actions in view. */}
        {tooMany && (
          <span className='block font-normal text-muted-foreground'>
            Up to {BANK_TRANSACTION_BULK_MAX_IDS} at once
          </span>
        )}
      </p>
      <span aria-hidden='true' className='mx-1 h-5 w-px shrink-0 bg-border' />
      <div className='flex min-w-0 items-center gap-1'>{children}</div>
    </div>
  );
}

/**
 * The bar's Leave out action, or Count in totals when every picked row is left out already. It applies at once; the
 * rows show the result.
 */
export function BulkLeftOutAction({
  tooMany,
  allLeftOut,
  isSaving,
  onApply,
}: {
  tooMany: boolean;
  /** Every picked row is left out, so the action counts them again. */
  allLeftOut: boolean;
  isSaving: boolean;
  onApply: (leftOutOfTotals: boolean) => void;
}) {
  return (
    <Button
      variant='ghost'
      disabled={isSaving || tooMany}
      onClick={() => onApply(!allLeftOut)}
      className='shrink-0'
    >
      {isSaving ? (
        <PendingLabel>Saving…</PendingLabel>
      ) : allLeftOut ? (
        <>
          <Eye aria-hidden='true' />
          Count in totals
        </>
      ) : (
        <>
          <EyeOff aria-hidden='true' />
          Leave out
        </>
      )}
    </Button>
  );
}

/**
 * The bar's Category action: a menu of categories on desktop, a bottom sheet of them on phones. Picking one hands it
 * on; the step that follows asks which rows change.
 */
export function BulkCategoryAction({
  count,
  tooMany,
  sheet,
  isChecking,
  onPick,
}: {
  count: number;
  tooMany: boolean;
  /** Phones pick from a bottom sheet. */
  sheet: boolean;
  /** The pick's preview is loading. */
  isChecking: boolean;
  onPick: (category: BankTransactionCategory) => void;
}) {
  const [open, setOpen] = useState(false);
  const disabled = isChecking || tooMany;
  const trigger = (
    <Button
      variant='ghost'
      disabled={disabled}
      onClick={sheet ? () => setOpen(true) : undefined}
      className='shrink-0'
    >
      {isChecking ? (
        <PendingLabel>Checking…</PendingLabel>
      ) : (
        <>
          <Tag aria-hidden='true' />
          Category
        </>
      )}
    </Button>
  );
  const pick = (category: BankTransactionCategory) => {
    setOpen(false);
    onPick(category);
  };

  if (sheet) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side='bottom'
            data-testid='bulk-category-sheet'
            className='flex flex-col gap-0 p-0 pb-[env(safe-area-inset-bottom)]'
          >
            <SheetHeader className='border-b px-4 py-3 pr-12'>
              <SheetTitle className='text-section-title'>
                Category for <span className='numeric'>{count}</span>
              </SheetTitle>
              <SheetDescription className='sr-only'>
                Pick one category for the selected transactions
              </SheetDescription>
            </SheetHeader>
            <ScrollArea type='auto' className='min-h-0'>
              <ul className='grid p-2'>
                {PICKABLE_CATEGORIES.map((category) => (
                  <li key={category}>
                    <button
                      type='button'
                      onClick={() => pick(category)}
                      className='flex min-h-14 w-full items-center gap-3 rounded-sm px-2 text-left text-body hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
                    >
                      <BankTransactionCategoryIcon
                        category={category}
                        className='size-9 shrink-0'
                        iconClassName='size-4'
                      />
                      <span className='min-w-0 truncate'>
                        {formatBankTransactionCategory(category)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side='top' align='start' className='w-60'>
        {PICKABLE_CATEGORIES.map((category) => (
          <DropdownMenuItem key={category} onSelect={() => pick(category)}>
            <BankTransactionCategoryIcon
              category={category}
              className='size-5 shrink-0'
              iconClassName='size-3'
            />
            <span className='min-w-0 truncate'>{formatBankTransactionCategory(category)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
