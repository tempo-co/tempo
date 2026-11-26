import {BankTransaction, BankTransactionCategory} from '@tempo/contracts';
import {toast} from 'sonner';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {wasToasted} from '@/utils/api';

import {usePreviewBankTransactionCategory} from '../api/use-preview-bank-transaction-category';
import {useUpdateBankTransactionCategory} from '../api/use-update-bank-transaction-category';
import {
  BANK_TRANSACTION_CATEGORY_META,
  PICKABLE_CATEGORIES,
} from '../utils/bank-transaction-category-meta';
import {
  formatBankTransactionCategory,
  formatBankTransactionCategorySource,
  formatBankTransactionCategoryStatus,
  isBankTransactionCategory,
  isToCheck,
  toBankTransactionCategory,
} from '../utils/formatters';
import {useStartCategoryDraft} from './bank-transaction-category-draft';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';

type BankTransactionCategorySelectProps = {
  transaction: BankTransaction;
};

export function BankTransactionCategorySelect({transaction}: BankTransactionCategorySelectProps) {
  const {updateBankTransactionCategory, isPending} = useUpdateBankTransactionCategory();
  const {previewBankTransactionCategory, isPending: isChecking} =
    usePreviewBankTransactionCategory();
  const startDraft = useStartCategoryDraft();
  // A row to check has no category to show: the owner checks it by picking one.
  const toCheck = isToCheck(transaction);
  const selectId = `transaction-${transaction.id}-category`;
  const statusId = `transaction-${transaction.id}-category-status`;
  const selectedCategory = toCheck ? '' : (toBankTransactionCategory(transaction.category) ?? '');
  const statusLabel = formatBankTransactionCategoryStatus(transaction.categoryStatus);
  const sourceLabel = formatBankTransactionCategorySource(transaction.categorySource);

  const save = async (category: BankTransactionCategory) => {
    try {
      await updateBankTransactionCategory({
        id: transaction.id,
        category,
        applyToTransactionIds: [],
      });
    } catch {
      // The mutation toast reports the error.
    }
  };

  const handleValueChange = (value: string) => {
    if (!isBankTransactionCategory(value)) return;
    previewBankTransactionCategory(
      {id: transaction.id, category: value},
      {
        onSuccess: (impact) => {
          if (impact.transactions.length > 0) startDraft({category: value, impact});
          else void save(value);
        },
        onError: (error) => {
          if (!wasToasted(error)) {
            toast.error('Category changes could not be previewed. Nothing was saved. Try again.');
          }
        },
      },
    );
  };

  return (
    <div className='col-span-2 min-w-0' data-testid='bank-transaction-category-control'>
      <dt className='flex items-center justify-between gap-3 text-body-small font-medium text-muted-foreground'>
        <label htmlFor={selectId} className='shrink-0'>
          Transaction category
        </label>
        <span
          id={statusId}
          role='status'
          aria-live='polite'
          data-testid='bank-transaction-category-status'
          className='text-right font-normal'
        >
          {isChecking
            ? 'Checking other transactions…'
            : isPending
              ? 'Saving…'
              : toCheck
                ? 'To check'
                : transaction.categoryStatus === 'COMPLETED'
                  ? (sourceLabel ?? statusLabel)
                  : statusLabel}
        </span>
      </dt>
      <dd className='mt-2'>
        <Select
          value={selectedCategory}
          onValueChange={handleValueChange}
          disabled={isPending || isChecking}
        >
          <SelectTrigger
            id={selectId}
            aria-label='Transaction category'
            aria-describedby={statusId}
            className='h-14 w-full max-w-none border-0 bg-accent/50 px-3 text-body shadow-none hover:bg-accent'
          >
            <SelectValue
              placeholder={
                toCheck ? 'Pick a category' : formatBankTransactionCategory(transaction.category)
              }
            >
              {selectedCategory && <BankTransactionCategoryOption category={selectedCategory} />}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PICKABLE_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                <BankTransactionCategoryOption category={category} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </dd>
    </div>
  );
}

export function BankTransactionCategoryOption({category}: {category: BankTransactionCategory}) {
  return (
    <span className='inline-flex min-w-0 items-center gap-2'>
      <BankTransactionCategoryIcon category={category} />
      <span className='truncate'>{BANK_TRANSACTION_CATEGORY_META[category].label}</span>
    </span>
  );
}
