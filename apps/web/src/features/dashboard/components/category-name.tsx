import {isBankTransactionCategory} from '@tempo/contracts';

import {BankTransactionCategoryIcon} from '@/features/banking/components/bank-transaction-category-icon';
import {cn} from '@/utils/cn';

import {categoryLabel} from '../utils/format';

const ICON_SIZE = 'size-5';

/** The category's icon, as in the Transactions category filter, then its name. */
export function CategoryName({
  category,
  className,
  labelClassName = 'truncate',
}: {
  /** A category, or `UNCATEGORIZED`. */
  category: string;
  className?: string;
  labelClassName?: string;
}) {
  const label = categoryLabel(category);
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <BankTransactionCategoryIcon
        category={isBankTransactionCategory(category) ? category : null}
        className={ICON_SIZE}
      />
      <span className={labelClassName} title={label}>
        {label}
      </span>
    </span>
  );
}

/** The icon's space, so a row without a category still starts its name where the others do. */
export function CategoryIconSpacer() {
  return <span aria-hidden='true' className={cn('shrink-0', ICON_SIZE)} />;
}
