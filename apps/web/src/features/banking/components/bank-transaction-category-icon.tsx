import {cn} from '@/utils/cn';

import {BankTransactionCategory} from '../types/bank-transaction';
import {BANK_TRANSACTION_CATEGORY_META} from '../utils/bank-transaction-category-meta';

type BankTransactionCategoryIconProps = {
  category: BankTransactionCategory;
  className?: string;
};

export function BankTransactionCategoryIcon({
  category,
  className,
}: BankTransactionCategoryIconProps) {
  const {icon: Icon, colorClassName} = BANK_TRANSACTION_CATEGORY_META[category];

  return (
    <span
      aria-hidden='true'
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
        colorClassName,
        className,
      )}
    >
      <Icon className='h-3.5 w-3.5' strokeWidth={1.8} />
    </span>
  );
}
