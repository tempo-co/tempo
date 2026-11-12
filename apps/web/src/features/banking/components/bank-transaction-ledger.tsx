import type {BankTransaction} from '@tempo/contracts';
import {format, isThisYear, isToday, isYesterday, parseISO} from 'date-fns';
import {SearchX} from 'lucide-react';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {Button} from '@/components/ui/button';
import {cn} from '@/utils/cn';

import {useActiveBankAccounts} from '../api/use-active-bank-accounts';
import {
  formatBankTransactionActivity,
  formatBankTransactionCategory,
  formatBankTransactionCompactDate,
  resolveBankTransactionAccountLabel,
  resolveBankTransactionDisplayTitle,
  toBankTransactionCategory,
} from '../utils/formatters';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';
import {MerchantLogoTile} from './merchant-logo-tile';

type LedgerProps = {
  transactions: BankTransaction[];
  /** Newest or oldest first: rows sit under their day. Amount order lists them flat with dates on the rows. */
  groupByDay: boolean;
  isFiltered: boolean;
  onClearFilters: () => void;
  onTransactionSelect: (id: BankTransaction['id'], trigger: HTMLButtonElement) => void;
};

const dayOf = (transaction: BankTransaction) =>
  transaction.bookingDate ?? transaction.transactionDate ?? '';

function formatLedgerDay(value: string) {
  if (!value) return 'No date';
  const date = parseISO(value);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, isThisYear(date) ? 'EEEE d MMMM' : 'EEEE d MMMM yyyy');
}

/** The Transactions page's rows: one card per day, every row the shared 60px row with its 36px tile. */
export function BankTransactionLedger({
  transactions,
  groupByDay,
  isFiltered,
  onClearFilters,
  onTransactionSelect,
}: LedgerProps) {
  const {accounts, needsAccountName} = useActiveBankAccounts();
  const showAccount = accounts.length > 1;

  if (transactions.length === 0) {
    return (
      <div className='flex flex-col items-center gap-4 rounded-card border bg-card px-5 py-10 text-center'>
        <SearchX aria-hidden='true' className='size-10 text-muted-foreground' />
        <p className='text-sm text-muted-foreground'>
          {isFiltered ? 'No transactions match these filters.' : 'No transactions yet.'}
        </p>
        {isFiltered && (
          <Button variant='outline' onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>
    );
  }

  // The bank names the account unless it holds several in one currency; then the account's own name does.
  const accountLabel = (transaction: BankTransaction) => {
    if (!showAccount) return null;
    return needsAccountName(transaction)
      ? resolveBankTransactionAccountLabel(transaction)
      : transaction.bankName;
  };
  const row = (transaction: BankTransaction) => (
    <li key={transaction.id} data-testid={`bank-transaction-row-${transaction.id}`}>
      <LedgerRow
        transaction={transaction}
        showDate={!groupByDay}
        account={accountLabel(transaction)}
        onSelect={onTransactionSelect}
      />
    </li>
  );

  if (!groupByDay) {
    return (
      <ul
        aria-label='Transactions'
        data-testid='bank-transaction-ledger'
        className='divide-y divide-border/60 overflow-hidden rounded-card border bg-card'
      >
        {transactions.map(row)}
      </ul>
    );
  }

  // Rows not yet booked come last from the API; they join their day's card instead of opening a second one.
  const days = new Map<string, BankTransaction[]>();
  for (const transaction of transactions) {
    const day = dayOf(transaction);
    days.set(day, [...(days.get(day) ?? []), transaction]);
  }

  return (
    <div className='grid gap-5' data-testid='bank-transaction-ledger'>
      {[...days].map(([day, rows]) => {
        const label = formatLedgerDay(day);
        return (
          <section key={day} aria-label={label} className='grid gap-1.5'>
            <h2 className='px-1 text-xs font-medium text-muted-foreground'>{label}</h2>
            <ul className='divide-y divide-border/60 overflow-hidden rounded-card border bg-card'>
              {rows.map(row)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function LedgerRow({
  transaction,
  showDate,
  account,
  onSelect,
}: {
  transaction: BankTransaction;
  showDate: boolean;
  account: string | null;
  onSelect: LedgerProps['onTransactionSelect'];
}) {
  const title = resolveBankTransactionDisplayTitle(transaction);
  const activity = formatBankTransactionActivity(transaction);
  const isCategorizing =
    !transaction.category && ['PENDING', 'PROCESSING'].includes(transaction.categoryStatus);
  const category =
    activity ||
    (isCategorizing ? 'Categorizing…' : formatBankTransactionCategory(transaction.category));
  const needsOwner =
    !activity &&
    (transaction.categoryStatus === 'FAILED' || transaction.category === 'NEEDS_REVIEW');
  const date = formatBankTransactionCompactDate(dayOf(transaction) || null);
  // Merchant logos fill most tiles, so the category keeps its own icon beside its name.
  const categoryIcon = (className: string, iconClassName: string) => (
    <BankTransactionCategoryIcon
      category={toBankTransactionCategory(transaction.category)}
      activity={Boolean(activity)}
      className={cn('shrink-0', className)}
      iconClassName={iconClassName}
    />
  );
  const counterparty = transaction.counterpartyName?.replace(/\s+/g, ' ').trim();
  const desktopSubline = [
    showDate ? date : null,
    counterparty && counterparty !== title ? counterparty : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type='button'
      aria-label={`View ${title} transaction details`}
      onClick={(event) => onSelect(transaction.id, event.currentTarget)}
      className={cn(
        // The row fills its card edge to edge, so hover and the click target do too; the card clips the corners and
        // the focus ring sits inside the row. One set of tracks for every list, so Category sits in the same place with or without accounts.
        'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring lg:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(8rem,max-content)]',
      )}
    >
      <MerchantLogoTile transaction={transaction} />
      <div className='min-w-0'>
        <p className='truncate text-sm'>{title}</p>
        <p
          className='flex h-4 min-w-0 items-center gap-1 text-xs text-muted-foreground lg:hidden'
          data-testid='ledger-row-meta'
        >
          {showDate && <span className='shrink-0'>{date} ·</span>}
          {categoryIcon('h-4 w-4', 'h-2.5 w-2.5')}
          <span className={cn('truncate', needsOwner && 'text-warning')}>{category}</span>
          {account && <span className='min-w-0 shrink-[2] truncate'>· {account}</span>}
        </p>
        {desktopSubline && (
          <p className='hidden truncate text-xs text-muted-foreground lg:block'>{desktopSubline}</p>
        )}
      </div>
      <p
        className={cn(
          'hidden min-w-0 items-center gap-2 text-sm text-muted-foreground lg:flex',
          needsOwner && 'text-warning',
        )}
        data-testid='ledger-row-category'
      >
        {categoryIcon('h-5 w-5', 'h-3 w-3')}
        <span className='truncate'>{category}</span>
      </p>
      {account ? (
        <p
          className='hidden truncate text-sm text-muted-foreground lg:block'
          data-testid='ledger-row-account'
        >
          {account}
        </p>
      ) : (
        <span aria-hidden='true' className='hidden lg:block' />
      )}
      <span className='text-right text-sm whitespace-nowrap' data-testid='ledger-row-amount'>
        <CurrencyAmount amount={Number(transaction.amount)} currency={transaction.currency} />
      </span>
    </button>
  );
}
