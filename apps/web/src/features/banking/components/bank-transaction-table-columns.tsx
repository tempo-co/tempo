import {ColumnDef} from '@tanstack/react-table';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {SortButton} from '@/components/shared/sort-button';
import {Badge} from '@/components/ui/badge';

import {BankTransaction, BankTransactionSortField} from '../types/bank-transaction';
import {
  formatBankTransactionCategory,
  formatBankTransactionCategorySource,
  formatBankTransactionCategoryStatus,
  formatBankTransactionDate,
  formatBankTransactionType,
  isBankTransactionCategory,
  resolveBankTransactionDisplayTitle,
} from '../utils/formatters';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';

export const bankTransactionTableColumns: ColumnDef<BankTransaction>[] = [
  {
    accessorKey: BankTransactionSortField.BOOKING_DATE,
    header: ({column}) => <SortButton column={column}>Booking date</SortButton>,
    cell: ({row}) => <p>{formatBankTransactionDate(row.original.bookingDate)}</p>,
  },
  {
    id: 'valueDate',
    header: () => <p className='px-3'>Value date</p>,
    cell: ({row}) => (
      <p>
        <span className='mr-1 hidden text-muted-foreground max-md:inline'>Value</span>
        {formatBankTransactionDate(row.original.valueDate)}
      </p>
    ),
  },
  {
    id: 'description',
    header: () => <p className='px-3'>Description</p>,
    cell: ({row}) => {
      const displayDescription = resolveBankTransactionDisplayTitle(row.original);
      const counterpartyName = row.original.counterpartyName?.trim();

      return (
        <div className='w-full max-w-[10rem] max-md:max-w-none sm:max-w-[14rem] lg:max-w-[16rem] xl:max-w-[20rem] min-[1320px]:max-w-[24rem]'>
          <p className='overflow-hidden text-ellipsis whitespace-nowrap'>{displayDescription}</p>
          {counterpartyName &&
            row.original.description &&
            displayDescription !== counterpartyName.replace(/\s+/g, ' ').trim() && (
              <p className='overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground max-md:hidden'>
                {counterpartyName}
              </p>
            )}
        </div>
      );
    },
  },
  {
    id: 'category',
    header: () => <p className='px-3'>Category</p>,
    cell: ({row}) => {
      const category =
        row.original.category && isBankTransactionCategory(row.original.category)
          ? row.original.category
          : null;
      const source = formatBankTransactionCategorySource(row.original.categorySource);

      return (
        <div className='max-w-[14rem]'>
          <div className='flex min-w-0 items-center gap-2'>
            {category && <BankTransactionCategoryIcon category={category} />}
            <p className='overflow-hidden text-ellipsis whitespace-nowrap'>
              {formatBankTransactionCategory(row.original.category)}
            </p>
          </div>
          <p className='overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground'>
            {formatBankTransactionCategoryStatus(row.original.categoryStatus)}
            {source && ` · ${source}`}
          </p>
        </div>
      );
    },
  },
  {
    id: 'transactionType',
    header: () => <p className='px-3'>Type</p>,
    cell: ({row}) => (
      <Badge variant='outline'>{formatBankTransactionType(row.original.transactionType)}</Badge>
    ),
  },
  {
    id: 'source',
    header: () => <p className='px-3'>Source</p>,
    cell: ({row}) => (
      <div className='max-w-[12rem]'>
        <p className='overflow-hidden text-ellipsis whitespace-nowrap'>{row.original.bankName}</p>
        <p className='overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground'>
          {row.original.bankAccountAlias || row.original.bankAccountName || 'Bank account'}
        </p>
      </div>
    ),
  },
  {
    accessorKey: BankTransactionSortField.AMOUNT,
    header: ({column}) => <SortButton column={column}>Amount</SortButton>,
    cell: ({row}) => (
      <div className='text-right'>
        <CurrencyAmount amount={Number(row.original.amount)} currency={row.original.currency} />
      </div>
    ),
  },
];
