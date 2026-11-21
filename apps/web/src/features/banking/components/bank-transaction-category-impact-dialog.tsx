import {BankTransactionCategory, BankTransactionCategoryImpact} from '@tempo/contracts';
import {useState} from 'react';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {PendingLabel} from '@/components/shared/pending-label';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';

import {formatBankTransactionCategory, formatBankTransactionDate} from '../utils/formatters';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';

type BankTransactionCategoryImpactDialogProps = {
  category: BankTransactionCategory;
  impact: BankTransactionCategoryImpact;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (selectedIds: string[]) => void;
};

function CategoryLabel({category}: {category: BankTransactionCategory | null}) {
  return (
    <span className='inline-flex items-center gap-1.5'>
      <BankTransactionCategoryIcon category={category} className='h-5 w-5' />
      <span>{formatBankTransactionCategory(category)}</span>
    </span>
  );
}

export function BankTransactionCategoryImpactDialog({
  category,
  impact,
  isPending,
  onCancel,
  onConfirm,
}: BankTransactionCategoryImpactDialogProps) {
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(impact.transactions.map(({id}) => id)),
  );
  const toggle = (id: string, selected: boolean) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && !isPending && onCancel()}>
      <ResponsiveDialogContent
        data-testid='category-impact-dialog'
        className='flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 md:max-w-xl'
      >
        <ResponsiveDialogHeader className='shrink-0 border-b p-5 text-left md:pr-12'>
          <ResponsiveDialogTitle>Update other transactions?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='pt-2'>
            This transaction will be set to {formatBankTransactionCategory(category)}. Choose which
            other transactions to {impact.action === 'RECHECK' ? 're-check with AI' : 'update'}.
            Nothing is saved until you confirm.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className='min-h-0 overflow-y-auto overscroll-contain p-5'>
          {impact.total > impact.transactions.length && (
            <p role='status' className='mb-4 text-sm text-muted-foreground'>
              Showing the newest {impact.transactions.length} of {impact.total} matches. Only the
              selected transactions below will change.
            </p>
          )}
          <fieldset disabled={isPending}>
            <legend className='sr-only'>Other transactions to change</legend>
            <ul className='divide-y'>
              {impact.transactions.map((transaction) => (
                <li key={transaction.id}>
                  <label className='flex cursor-pointer items-start gap-3 py-3'>
                    <Checkbox
                      className='mt-0.5'
                      checked={selectedIds.has(transaction.id)}
                      onCheckedChange={(checked) => toggle(transaction.id, checked === true)}
                    />
                    <span className='min-w-0 flex-1 space-y-1'>
                      <span className='block text-sm leading-none font-medium wrap-anywhere'>
                        {transaction.displayDescription}
                      </span>
                      <span className='block text-xs text-muted-foreground'>
                        {formatBankTransactionDate(
                          transaction.transactionDate ?? transaction.bookingDate,
                        )}
                        {' · '}
                        <CurrencyAmount
                          amount={Number(transaction.amount)}
                          currency={transaction.currency}
                        />
                      </span>
                      <span className='flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-1 text-sm'>
                        <CategoryLabel category={transaction.category} />
                        <span className='text-muted-foreground'>{' → '}</span>
                        {impact.action === 'RECHECK' ? (
                          <span>Will be re-checked by AI</span>
                        ) : (
                          <CategoryLabel category={impact.category} />
                        )}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <p className='mt-3 text-xs text-muted-foreground'>
            Unticked transactions stay as they are. They may be offered again on a later correction.
          </p>
        </div>
        <ResponsiveDialogFooter className='shrink-0 gap-2 border-t p-5'>
          <Button
            disabled={isPending || selectedIds.size === 0}
            className='md:order-3'
            onClick={() =>
              onConfirm(impact.transactions.filter(({id}) => selectedIds.has(id)).map(({id}) => id))
            }
          >
            {isPending ? (
              <PendingLabel>Saving…</PendingLabel>
            ) : (
              `Update selected (${selectedIds.size})`
            )}
          </Button>
          <Button
            variant='outline'
            disabled={isPending}
            className='md:order-2'
            onClick={() => onConfirm([])}
          >
            Just this one
          </Button>
          <Button variant='outline' disabled={isPending} className='md:order-1' onClick={onCancel}>
            Cancel
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
