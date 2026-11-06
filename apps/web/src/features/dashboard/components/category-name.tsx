import {type BankTransactionBreakdownPart, isBankTransactionCategory} from '@tempo/contracts';

import {BankTransactionCategoryIcon} from '@/features/banking/components/bank-transaction-category-icon';
import {MerchantLogoTile} from '@/features/banking/components/merchant-logo-tile';
import {cn} from '@/utils/cn';

import {categoryLabel} from '../utils/format';
import {TruncatedText} from './data-tip';

const ICON_SIZE = 'size-5';

/** A category's icon at the height of a readout's line. */
export function ReadoutCategoryIcon({category}: {category: string}) {
  return (
    <BankTransactionCategoryIcon
      category={isBankTransactionCategory(category) ? category : null}
      className='size-4 rounded-sm'
      iconClassName='size-3'
    />
  );
}

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
      <TruncatedText className={labelClassName}>{label}</TruncatedText>
    </span>
  );
}

/** An income source's tile, as on its transactions: its latest merchant's logo, else that income's category icon. */
export function SourceTile({
  source,
  small,
}: {
  source: Pick<BankTransactionBreakdownPart, 'merchantLogoUrl' | 'category'> | undefined;
  /** At the height of a readout's line. */
  small?: boolean;
}) {
  return (
    <MerchantLogoTile
      transaction={{
        merchantLogoUrl: source?.merchantLogoUrl ?? null,
        category: source?.category ?? null,
        cashFlowTreatment: 'INCOME',
      }}
      className={small ? 'size-4' : ICON_SIZE}
      iconClassName={small ? 'size-2.5' : 'size-3'}
    />
  );
}

/** An income source's tile, then its name, in the place and size of a category's icon and name. */
export function SourceName({
  source,
  label,
  className,
  labelClassName = 'truncate',
}: {
  source: Pick<BankTransactionBreakdownPart, 'merchantLogoUrl' | 'category'> | undefined;
  label: string;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <SourceTile source={source} />
      <TruncatedText className={labelClassName}>{label}</TruncatedText>
    </span>
  );
}

/** The icon's space, so a row without an icon still starts its name where the others do. */
export function CategoryIconSpacer() {
  return <span aria-hidden='true' className={cn('shrink-0', ICON_SIZE)} />;
}
