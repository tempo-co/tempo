import {RefreshCw, Tags} from 'lucide-react';

import {cn} from '@/utils/cn';

import {BankTransactionCategory} from '../types/bank-transaction';
import {BANK_TRANSACTION_CATEGORY_META} from '../utils/bank-transaction-category-meta';

type BankTransactionCategoryIconProps = {
  /** Null renders the neutral icon used for uncategorized transactions. */
  category: BankTransactionCategory | null;
  /** Own transfers and currency exchanges show a neutral activity icon instead of the category. */
  activity?: boolean;
  className?: string;
};

export function BankTransactionCategoryIcon({
  category,
  activity = false,
  className,
}: BankTransactionCategoryIconProps) {
  const {icon: Icon, colorClassName} =
    !activity && category
      ? BANK_TRANSACTION_CATEGORY_META[category]
      : {icon: activity ? RefreshCw : Tags, colorClassName: 'border-border text-muted-foreground'};

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
