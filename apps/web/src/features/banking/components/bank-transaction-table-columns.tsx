import {ColumnDef} from '@tanstack/react-table';
import {RefreshCw} from 'lucide-react';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {SortButton} from '@/components/shared/sort-button';

import {BankTransaction, BankTransactionSortField} from '../types/bank-transaction';
import {
  formatBankTransactionCashFlowTreatment,
  formatBankTransactionCategory,
  formatBankTransactionCategorySource,
  formatBankTransactionCategoryStatus,
  formatBankTransactionDate,
  formatBankTransactionFinancialEvent,
  isBankTransactionCategory,
  resolveBankTransactionAccountLabel,
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
    header: ({column}) => <SortButton column={column}>Category</SortButton>,
    cell: ({row}) => {
      const financialEvent = formatBankTransactionFinancialEvent(row.original.financialEventType);
      const category =
        !row.original.category || !isBankTransactionCategory(row.original.category)
          ? null
          : row.original.category;
      const hasManualCategory = Boolean(
        financialEvent && category && row.original.categorySource === 'MANUAL',
      );
      const source = formatBankTransactionCategorySource(row.original.categorySource);
      const cashFlowTreatment = formatBankTransactionCashFlowTreatment(
        row.original.cashFlowTreatment,
      );

      return (
        <div className='w-full min-w-0'>
          <div className='flex h-6 min-w-0 items-center gap-2'>
            {financialEvent ? (
              <RefreshCw className='h-4 w-4 shrink-0 text-muted-foreground' aria-hidden='true' />
            ) : (
              category && <BankTransactionCategoryIcon category={category} />
            )}
            <p className='overflow-hidden text-ellipsis whitespace-nowrap'>
              {financialEvent || formatBankTransactionCategory(row.original.category)}
            </p>
          </div>
          <p className='overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground'>
            {financialEvent
              ? hasManualCategory
                ? `Category: ${formatBankTransactionCategory(category)}${source ? ` · ${source}` : ''} · ${cashFlowTreatment}`
                : `${formatBankTransactionCategoryStatus(row.original.categoryStatus)} · ${cashFlowTreatment}`
              : formatBankTransactionCategoryStatus(row.original.categoryStatus)}
            {!financialEvent && source && ` · ${source}`}
          </p>
        </div>
      );
    },
  },

  {
    id: 'source',
    header: ({column}) => <SortButton column={column}>Source</SortButton>,
    cell: ({row}) => (
      <div className='w-full min-w-0'>
        <p className='overflow-hidden text-ellipsis whitespace-nowrap'>{row.original.bankName}</p>
        <p className='overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground'>
          {resolveBankTransactionAccountLabel(row.original)}
        </p>
      </div>
    ),
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
