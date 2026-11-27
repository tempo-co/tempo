import type {BankTransaction, BankTransactionDayTotal} from '@tempo/contracts';
import {format, isThisYear, isToday, isYesterday, parseISO} from 'date-fns';
import {EyeOff} from 'lucide-react';
import type {ReactNode} from 'react';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import type {RowSelection} from '@/hooks/use-row-selection';
import {cn} from '@/utils/cn';

import {useActiveBankAccounts} from '../api/use-active-bank-accounts';
import {
  formatBankTransactionActivity,
  formatBankTransactionCategory,
  formatBankTransactionCompactDate,
  isPendingBankTransaction,
  isToCheck,
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
  /** Shown in place of the rows when there are none. */
  empty: ReactNode;
  onTransactionSelect: (id: BankTransaction['id'], trigger: HTMLButtonElement) => void;
  /** The row whose details are open beside the list. */
  selectedId?: BankTransaction['id'];
  /** Each day's totals by date, in the reporting currency; a day without one shows its label alone. */
  dayTotals?: Map<string, BankTransactionDayTotal & {currency: string}>;
  /** Rows picked for a bulk action; without it the list has no checkboxes. */
  selection?: LedgerSelection;
};

type LedgerSelection = {
  rows: RowSelection;
  /** A press on a row picks it instead of opening it: in Select mode, or while any row is picked. */
  picking: boolean;
  /** How many rows the list's filters match; more than are loaded offers to select every one. */
  matching: number;
};

const dayOf = (transaction: BankTransaction) => transaction.date ?? '';

function formatLedgerDay(value: string) {
  if (!value) return 'No date';
  const date = parseISO(value);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, isThisYear(date) ? 'EEEE d MMMM' : 'EEEE d MMMM yyyy');
}

/** What a day spent and earned, as its header shows it: "-€54.12", "+€2,000.00" in green, or both. */
function DayTotal({day}: {day: BankTransactionDayTotal & {currency: string}}) {
  const spent = Number(day.spending) !== 0;
  const earned = Number(day.income) !== 0;
  if (!spent && !earned) return null;
  return (
    <p className='shrink-0' data-testid='ledger-day-total'>
      <span className='sr-only'>Day total </span>
      {spent && <CurrencyAmount amount={-Number(day.spending)} currency={day.currency} />}
      {spent && earned && ' · '}
      {earned && <CurrencyAmount amount={Number(day.income)} currency={day.currency} />}
    </p>
  );
}

/** The Transactions page's rows: one card per day under its total, every row the shared 60px row with its 36px tile. */
export function BankTransactionLedger({
  transactions,
  groupByDay,
  empty,
  onTransactionSelect,
  selectedId,
  dayTotals,
  selection,
}: LedgerProps) {
  const {accounts, needsAccountName} = useActiveBankAccounts();
  const showAccount = accounts.length > 1;

  if (transactions.length === 0) return empty;

  // The bank names the account unless it holds several in one currency; then the account's own name does.
  const accountLabel = (transaction: BankTransaction) => {
    if (!showAccount) return null;
    return needsAccountName(transaction.bankAccountId)
      ? resolveBankTransactionAccountLabel(transaction)
      : transaction.bankName;
  };
  const row = (transaction: BankTransaction) => (
    <li key={transaction.id} data-testid={`bank-transaction-row-${transaction.id}`}>
      <LedgerRow
        transaction={transaction}
        showDate={!groupByDay}
        account={accountLabel(transaction)}
        selected={transaction.id === selectedId}
        onSelect={onTransactionSelect}
        selection={selection}
      />
    </li>
  );
  const header = selection && (
    <SelectAllRow
      selection={selection.rows}
      count={transactions.length}
      matching={selection.matching}
    />
  );

  if (!groupByDay) {
    return (
      <div className='@container grid gap-1.5' data-testid='bank-transaction-ledger'>
        {header}
        <ul
          aria-label='Transactions'
          className='divide-y divide-border/60 overflow-hidden rounded-lg border bg-card'
        >
          {transactions.map(row)}
        </ul>
      </div>
    );
  }

  const days = new Map<string, BankTransaction[]>();
  for (const transaction of transactions) {
    const day = dayOf(transaction);
    days.set(day, [...(days.get(day) ?? []), transaction]);
  }

  return (
    // The rows lay out by the list's own width, which the rail beside it narrows.
    <div className='@container grid gap-5' data-testid='bank-transaction-ledger'>
      {header}
      {[...days].map(([day, rows]) => {
        const label = formatLedgerDay(day);
        const totals = dayTotals?.get(day);
        return (
          <section key={day} aria-label={label} className='grid gap-1.5'>
            <div className='flex items-baseline justify-between gap-3 px-1 text-body-small text-muted-foreground'>
              <h2 className='min-w-0 truncate font-medium'>{label}</h2>
              {totals && <DayTotal day={totals} />}
            </div>
            <ul className='divide-y divide-border/60 overflow-hidden rounded-lg border bg-card'>
              {rows.map(row)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * "Select all 50" picks the loaded rows; once they are all picked and the filters match more, "Select all 1240
 * matching" picks every one of those too.
 */
function SelectAllRow({
  selection,
  count,
  matching,
}: {
  selection: RowSelection;
  count: number;
  matching: number;
}) {
  const picked = selection.selectedIds.length;
  const label = selection.allMatching
    ? `All ${matching} selected`
    : picked > 0
      ? `${picked} of ${count} selected`
      : `Select all ${count}`;
  return (
    <div className='flex flex-wrap items-center gap-x-4 px-3 text-body-small text-muted-foreground'>
      <label className='flex min-h-8 cursor-pointer items-center gap-3 max-sm:min-h-11'>
        <Checkbox
          checked={selection.allSelected ? true : picked > 0 ? 'indeterminate' : false}
          onCheckedChange={() => selection.toggleAll()}
          aria-label={selection.allSelected ? 'Clear the selection' : `Select all ${count}`}
          className='border-input'
        />
        <span className='numeric' data-testid='ledger-selection-count'>
          {label}
        </span>
      </label>
      {selection.allSelected && !selection.allMatching && matching > count && (
        <Button
          variant='link'
          onClick={selection.selectAllMatching}
          className='h-auto min-h-8 p-0 text-body-small text-foreground max-sm:min-h-11'
        >
          <span>
            Select all <span className='numeric'>{matching}</span> matching
          </span>
        </Button>
      )}
    </div>
  );
}

/** The marker on a row the owner left out of totals. */
/** The pill of a row no total counts: left out by the owner, or on an account they hid. */
function LeftOutTag({hiddenAccount}: {hiddenAccount: boolean}) {
  return (
    <span
      className='inline-flex h-4 shrink-0 items-center gap-1 rounded-full border bg-card px-1.5 text-caption text-muted-foreground'
      data-testid='ledger-row-left-out'
    >
      <EyeOff aria-hidden='true' className='size-3' />
      {hiddenAccount ? 'Hidden account' : 'Left out of totals'}
    </span>
  );
}

function LedgerRow({
  transaction,
  showDate,
  account,
  selected,
  onSelect,
  selection,
}: {
  transaction: BankTransaction;
  showDate: boolean;
  account: string | null;
  selected: boolean;
  onSelect: LedgerProps['onTransactionSelect'];
  selection?: LedgerSelection;
}) {
  const title = resolveBankTransactionDisplayTitle(transaction);
  const activity = formatBankTransactionActivity(transaction);
  const isCategorizing =
    !transaction.category && ['PENDING', 'PROCESSING'].includes(transaction.categoryStatus);
  // A row to check shows no category: there is no guess to show, and the owner picks one.
  const toCheck = !activity && isToCheck(transaction);
  const category = toCheck
    ? 'To check'
    : activity ||
      (isCategorizing ? 'Categorizing…' : formatBankTransactionCategory(transaction.category));
  const date = formatBankTransactionCompactDate(dayOf(transaction) || null);
  const pending = isPendingBankTransaction(transaction);
  // A hidden account's rows count in no total either, so they are marked the same way.
  const hiddenAccount = transaction.bankAccountHidden && !transaction.leftOutOfTotals;
  const leftOut = transaction.leftOutOfTotals || transaction.bankAccountHidden;
  // Merchant logos fill most tiles, so the category keeps its own icon beside its name.
  const categoryIcon = (className: string, iconClassName: string) =>
    toCheck ? (
      <span
        aria-hidden='true'
        className={cn('inline-flex shrink-0 items-center justify-center', className)}
      >
        <span className='size-2 rounded-full bg-warning' />
      </span>
    ) : (
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
    pending ? 'Pending' : null,
    counterparty && counterparty !== title ? counterparty : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const picked = selection?.rows.isSelected(transaction.id) ?? false;
  const row = (
    <button
      type='button'
      aria-label={
        selection?.picking
          ? `${picked ? 'Unselect' : 'Select'} ${title}`
          : `View ${title} transaction details${hiddenAccount ? ', on a hidden account' : leftOut ? ', left out of totals' : ''}`
      }
      aria-current={selected || undefined}
      aria-pressed={selection?.picking ? picked : undefined}
      onClick={(event) => {
        if (selection?.picking) selection.rows.toggle(transaction.id, {range: event.shiftKey});
        else onSelect(transaction.id, event.currentTarget);
      }}
      className={cn(
        // The row fills its card edge to edge, so hover and the click target do too; the card clips the corners and
        // the focus ring sits inside the row. One set of tracks for every list, so Category sits in the same place with or without accounts.
        'grid min-h-15 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-current:bg-accent @3xl:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(8rem,max-content)]',
        // The box sits in its own cell before the row, and the row with the box takes the hover and open washes.
        selection && 'pl-0 hover:bg-transparent aria-current:bg-transparent',
      )}
    >
      <MerchantLogoTile transaction={transaction} />
      <div className='min-w-0'>
        <p className={cn('truncate text-body', leftOut && 'text-muted-foreground')}>{title}</p>
        <p
          className='flex h-4 min-w-0 items-center gap-1 text-body-small text-muted-foreground @3xl:hidden'
          data-testid='ledger-row-meta'
        >
          {showDate && <span className='shrink-0'>{date} ·</span>}
          {pending && <span className='shrink-0'>Pending ·</span>}
          {leftOut && <LeftOutTag hiddenAccount={hiddenAccount} />}
          {categoryIcon('h-4 w-4', 'h-2.5 w-2.5')}
          <span className={cn('truncate', toCheck && 'text-warning')}>{category}</span>
          {account && <span className='min-w-0 shrink-[2] truncate'>· {account}</span>}
        </p>
        {(desktopSubline || leftOut) && (
          <p className='hidden h-5 min-w-0 items-center gap-1.5 text-body-small text-muted-foreground @3xl:flex'>
            {leftOut && <LeftOutTag hiddenAccount={hiddenAccount} />}
            <span className='truncate'>{desktopSubline}</span>
          </p>
        )}
      </div>
      <p
        className={cn(
          'hidden min-w-0 items-center gap-2 text-body-small text-muted-foreground @3xl:flex',
          toCheck && 'text-warning',
        )}
        data-testid='ledger-row-category'
      >
        {categoryIcon('h-5 w-5', 'h-3 w-3')}
        <span className='truncate'>{category}</span>
      </p>
      {account ? (
        <p
          className='hidden truncate text-body-small text-muted-foreground @3xl:block'
          data-testid='ledger-row-account'
        >
          {account}
        </p>
      ) : (
        <span aria-hidden='true' className='hidden @3xl:block' />
      )}
      <span
        className={cn(
          'text-right text-body whitespace-nowrap',
          // Counted in no total: struck through and quiet, income too.
          leftOut && 'line-through *:text-muted-foreground',
        )}
        data-testid='ledger-row-amount'
      >
        <CurrencyAmount amount={Number(transaction.amount)} currency={transaction.currency} />
      </span>
    </button>
  );
  if (!selection) return row;

  return (
    <div
      className={cn(
        'group/row grid grid-cols-[auto_minmax(0,1fr)] items-stretch hover:bg-accent/50',
        (picked || selected) && 'bg-accent hover:bg-accent',
      )}
    >
      {/* Its own cell, wide enough to press; faint until the row is hovered, the box focused or checked. */}
      <span className='flex items-center pr-3 pl-3'>
        <Checkbox
          checked={picked}
          aria-label={`Select ${title}`}
          // A click carries Shift for a range; the box's own toggle would drop it.
          onClick={(event) => {
            event.preventDefault();
            selection.rows.toggle(transaction.id, {range: event.shiftKey});
          }}
          className={cn(
            'relative border-input opacity-40 group-hover/row:opacity-100 after:absolute after:-inset-3.5 focus-visible:opacity-100 data-[state=checked]:opacity-100',
            selection.picking && 'opacity-100',
          )}
        />
      </span>
      {row}
    </div>
  );
}
