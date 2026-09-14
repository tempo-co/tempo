import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {useUpdateBankTransactionCategory} from '../api/use-update-bank-transaction-category';
import {
  BANK_TRANSACTION_CATEGORIES,
  BankTransaction,
  BankTransactionCategory,
} from '../types/bank-transaction';
import {BANK_TRANSACTION_CATEGORY_META} from '../utils/bank-transaction-category-meta';
import {
  formatBankTransactionCategory,
  formatBankTransactionCategorySource,
  formatBankTransactionCategoryStatus,
  isBankTransactionCategory,
} from '../utils/formatters';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';

type BankTransactionCategorySelectProps = {
  transaction: BankTransaction;
};

export function BankTransactionCategorySelect({transaction}: BankTransactionCategorySelectProps) {
  const {updateBankTransactionCategory, isPending} = useUpdateBankTransactionCategory();
  const selectId = `transaction-${transaction.id}-category`;
  const statusId = `transaction-${transaction.id}-category-status`;
  const selectedCategory =
    transaction.category && isBankTransactionCategory(transaction.category)
      ? transaction.category
      : undefined;
  const statusLabel = formatBankTransactionCategoryStatus(transaction.categoryStatus);
  const sourceLabel = formatBankTransactionCategorySource(transaction.categorySource);

  const handleValueChange = (value: string) => {
    if (!isBankTransactionCategory(value)) return;
    updateBankTransactionCategory({id: transaction.id, category: value});
  };

  return (
    <div className='col-span-2 min-w-0' data-testid='bank-transaction-category-control'>
      <dt className='text-xs font-medium text-muted-foreground'>
        <label htmlFor={selectId}>Transaction category</label>
      </dt>
      <dd className='mt-2'>
        <Select value={selectedCategory} onValueChange={handleValueChange} disabled={isPending}>
          <SelectTrigger
            id={selectId}
            aria-label='Transaction category'
            aria-describedby={statusId}
            className='max-w-md'
          >
            <SelectValue placeholder={formatBankTransactionCategory(transaction.category)}>
              {selectedCategory && <BankTransactionCategoryOption category={selectedCategory} />}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {BANK_TRANSACTION_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                <BankTransactionCategoryOption category={category} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </dd>
      <dd
        id={statusId}
        role='status'
        aria-live='polite'
        data-testid='bank-transaction-category-status'
        className='mt-2 text-xs text-muted-foreground'
      >
        <span>{statusLabel}</span>
        {sourceLabel && (
          <>
            <span aria-hidden='true'> · </span>
            <span>{sourceLabel}</span>
          </>
        )}
      </dd>
    </div>
  );
}

function BankTransactionCategoryOption({category}: {category: BankTransactionCategory}) {
  return (
    <span className='inline-flex min-w-0 items-center gap-2'>
      <BankTransactionCategoryIcon category={category} />
      <span className='truncate'>{BANK_TRANSACTION_CATEGORY_META[category].label}</span>
    </span>
  );
}
