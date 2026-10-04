import {ColumnDef} from '@tanstack/react-table';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {SortButton} from '@/components/shared/sort-button';

import {BankTransaction, BankTransactionSortField} from '../types/bank-transaction';
import {
  formatBankTransactionActivity,
  formatBankTransactionCategory,
  formatBankTransactionCategorySubtitle,
  formatBankTransactionDate,
  isBankTransactionCategory,
  resolveBankTransactionDisplayTitle,
} from '../utils/formatters';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';
import {BankTransactionSourceCell} from './bank-transaction-source-cell';

export const bankTransactionTableColumns: ColumnDef<BankTransaction>[] = [
  {
    accessorKey: BankTransactionSortField.BOOKING_DATE,
    header: ({column}) => <SortButton column={column}>Booking date</SortButton>,
    cell: ({row}) => <p>{formatBankTransactionDate(row.original.bookingDate)}</p>,
  },
  {
    id: 'description',
    header: () => <p className='px-3'>Description</p>,
    cell: ({row}) => {
      const displayDescription = resolveBankTransactionDisplayTitle(row.original);
      const counterpartyName = row.original.counterpartyName?.trim();

      return (
        <div className='w-full min-w-0'>
          <p className='overflow-hidden text-ellipsis whitespace-nowrap'>{displayDescription}</p>
          {counterpartyName &&
            row.original.description &&
            displayDescription !== counterpartyName.replace(/\s+/g, ' ').trim() && (
              <p className='overflow-hidden text-xs text-ellipsis whitespace-nowrap text-muted-foreground max-lg:hidden'>
                {counterpartyName}
              </p>
            )}
        </div>
      );
    },
  },
  {
    id: 'category',
    header: ({column}) => <SortButton column={column}>Category</SortButton>,
    cell: ({row}) => {
      const financialEvent = formatBankTransactionActivity(row.original);
      const category =
        !row.original.category || !isBankTransactionCategory(row.original.category)
          ? null
          : row.original.category;
      const subtitle = formatBankTransactionCategorySubtitle(row.original);

      return (
        <div className='w-full min-w-0'>
          <div className='flex h-6 min-w-0 items-center gap-2'>
            <BankTransactionCategoryIcon category={category} activity={Boolean(financialEvent)} />
            <p className='overflow-hidden text-ellipsis whitespace-nowrap'>
              {financialEvent || formatBankTransactionCategory(row.original.category)}
            </p>
          </div>
          {subtitle && (
            <p className='overflow-hidden text-xs text-ellipsis whitespace-nowrap text-muted-foreground'>
              {subtitle}
            </p>
          )}
        </div>
      );
    },
  },

  {
    id: 'source',
    header: ({column}) => <SortButton column={column}>Source</SortButton>,
    cell: ({row}) => <BankTransactionSourceCell transaction={row.original} />,
  },
  {
    accessorKey: BankTransactionSortField.AMOUNT,
    header: ({column}) => (
      <SortButton column={column} className='justify-end text-right'>
        Amount
      </SortButton>
    ),
    cell: ({row}) => (
      <div className='text-right'>
        <CurrencyAmount amount={Number(row.original.amount)} currency={row.original.currency} />
      </div>
    ),
  },
];
