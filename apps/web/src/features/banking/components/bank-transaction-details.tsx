import {Link} from '@tanstack/react-router';
import {BankTransaction, BankTransactionCounterpart} from '@tempo/contracts';
import {ArrowDown, ArrowRight, Check, ChevronRight, Landmark} from 'lucide-react';
import {useState} from 'react';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {Button} from '@/components/ui/button';
import {useLocalDate} from '@/hooks/use-local-date';

import {bankLogoKey, useBankLogos} from '../api/use-bank-logos';
import {useGetBankTransactionRecurring} from '../api/use-get-bank-transaction-recurring';
import {useUpdateBankTransactionOwnTransfer} from '../api/use-update-bank-transaction-own-transfer';
import {RECURRING_CADENCE_LABELS} from '../types/recurring-series';
import {
  formatBankTransactionDate,
  formatBankTransactionExchangeRate,
  formatBankTransactionType,
  formatCounterpartAccount,
  formatOwnTransferEvidence,
  resolveBankTransactionAccountLabel,
} from '../utils/formatters';
import {BankLogo} from './bank-logo';
import {BankTransactionCategorySelect} from './bank-transaction-category-select';
import {MerchantLogoTile} from './merchant-logo-tile';

export function BankTransactionDetails({transaction}: {transaction: BankTransaction}) {
  const [bankDetailsOpen, setBankDetailsOpen] = useState(false);
  const bankDetailsId = `bank-details-${transaction.id}`;
  const isExchange = transaction.financialEventType === 'CURRENCY_EXCHANGE';
  const isMovement = isExchange || Boolean(transaction.ownTransfer);
  const counterpart = isExchange
    ? transaction.currencyExchangeCounterpart
    : transaction.ownTransfer?.counterpart;

  return (
    <div data-testid='bank-transaction-details' className='min-w-0 px-5 pb-5 sm:px-8 sm:pb-7'>
      {isMovement ? (
        <Movement transaction={transaction} counterpart={counterpart} />
      ) : (
        <section aria-label='Category' className='border-b py-5'>
          <dl>
            <BankTransactionCategorySelect key={transaction.id} transaction={transaction} />
          </dl>
        </section>
      )}
      {!isMovement && (
        <section aria-label='Account' className='flex items-center gap-3 border-b py-5'>
          <Landmark className='size-5 shrink-0 text-muted-foreground' aria-hidden='true' />
          <div className='min-w-0 flex-1'>
            <p className='text-label text-muted-foreground'>
              {transaction.direction === 'INCOME' ? 'Received into' : 'Paid from'}
            </p>
            <p className='mt-1 font-medium wrap-anywhere'>
              {resolveBankTransactionAccountLabel(transaction)}
            </p>
          </div>
          <p className='max-w-[45%] text-right text-sm wrap-anywhere text-muted-foreground'>
            {transaction.bankName}
          </p>
        </section>
      )}
      {!isMovement && <Recurring transaction={transaction} />}
      <section className='pt-2' data-testid='bank-details-fold'>
        <Button
          variant='ghost'
          size='sm'
          aria-expanded={bankDetailsOpen}
          aria-controls={bankDetailsId}
          onClick={() => setBankDetailsOpen(!bankDetailsOpen)}
          className='w-full justify-start px-0 text-muted-foreground max-sm:h-11'
        >
          <ChevronRight
            className={`transition-transform motion-reduce:transition-none ${bankDetailsOpen ? 'rotate-90' : ''}`}
            aria-hidden='true'
          />
          Bank details
        </Button>
        {bankDetailsOpen && (
          <div id={bankDetailsId} className='space-y-5 pt-3 pb-4'>
            <div>
              <p className='text-label text-muted-foreground'>Original description</p>
              <p className='mt-2 text-sm leading-relaxed wrap-anywhere'>
                {transaction.description || 'Not provided by your bank'}
              </p>
            </div>
            <dl className='grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2'>
              <Detail
                label='Transaction date'
                value={
                  transaction.transactionDate
                    ? formatBankTransactionDate(transaction.transactionDate)
                    : null
                }
              />
              <Detail
                label='Booking date'
                value={
                  transaction.bookingDate
                    ? formatBankTransactionDate(transaction.bookingDate)
                    : null
                }
              />
              <Detail
                label='Value date'
                value={
                  transaction.valueDate ? formatBankTransactionDate(transaction.valueDate) : null
                }
              />
              <Detail label='Counterparty' value={transaction.counterpartyName} />
              <Detail
                label='Transaction type'
                value={formatBankTransactionType(transaction.transactionType)}
              />
              <Detail label='Bank' value={`${transaction.bankName} (${transaction.bankCountry})`} />
              <Detail label='Merchant category code' value={transaction.merchantCategoryCode} />
              <Detail
                label='Provider classification'
                value={transaction.providerTransactionDescription}
              />
              <Detail
                label='Balance after transaction'
                value={
                  transaction.balanceAfterAmount && transaction.balanceAfterCurrency
                    ? `${Number(transaction.balanceAfterAmount).toFixed(2)} ${transaction.balanceAfterCurrency}`
                    : null
                }
              />
              <Detail
                label='Instructed amount'
                value={
                  transaction.instructedAmount && transaction.instructedCurrency
                    ? `${Number(transaction.instructedAmount).toFixed(2)} ${transaction.instructedCurrency}`
                    : null
                }
              />
              <Detail
                label='Exchange rate'
                value={
                  transaction.exchangeRate
                    ? `${formatBankTransactionExchangeRate(transaction)}${transaction.exchangeRateType ? ` (${transaction.exchangeRateType})` : ''}`
                    : null
                }
              />
              <Detail
                label='Payment reference'
                value={
                  transaction.referenceNumber
                    ? `${transaction.referenceNumber}${transaction.referenceNumberScheme ? ` (${transaction.referenceNumberScheme})` : ''}`
                    : null
                }
              />
            </dl>
            {transaction.ownTransfer && (
              <p className='text-sm text-muted-foreground'>
                {formatOwnTransferEvidence(transaction.ownTransfer.evidence)}
              </p>
            )}
          </div>
        )}
      </section>
      {!isExchange && <TransferSetting transaction={transaction} />}
    </div>
  );
}

function Detail({label, value}: {label: string; value: string | null}) {
  if (!value) return null;
  return (
    <div className='min-w-0'>
      <dt className='text-label text-muted-foreground'>{label}</dt>
      <dd className='mt-1 text-sm wrap-anywhere'>{value}</dd>
    </div>
  );
}

function Movement({
  transaction,
  counterpart,
}: {
  transaction: BankTransaction;
  counterpart: BankTransactionCounterpart | null | undefined;
}) {
  const incoming = transaction.direction === 'INCOME';
  const isExchange = transaction.financialEventType === 'CURRENCY_EXCHANGE';
  const bankLogos = useBankLogos(true);
  // The counterpart supplies no country: use its exact bank name only when the saved logos agree.
  const otherLogos = new Set(
    Object.entries(bankLogos)
      .filter(
        ([key]) => key.slice(key.indexOf(':') + 1) === counterpart?.bankName.trim().toLowerCase(),
      )
      .map(([, url]) => url),
  );
  const accountClassName =
    'grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-3 sm:row-span-4 sm:grid-rows-subgrid';
  const own = (
    <div data-testid='movement-own' className={accountClassName}>
      <MovementAccount
        label={incoming ? 'To' : 'From'}
        account={transaction}
        name={resolveBankTransactionAccountLabel(transaction)}
        logoUrl={bankLogos[bankLogoKey(transaction.bankName, transaction.bankCountry)]}
      />
    </div>
  );
  const other = counterpart ? (
    <Link
      to='.'
      search={(prev) => ({...prev, transactionId: counterpart.id})}
      state={(prev) => ({transactionOpenedAt: prev.transactionOpenedAt ?? prev.__TSR_index})}
      data-testid='movement-counterpart'
      className={`${accountClassName} hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring`}
    >
      <MovementAccount
        label={incoming ? 'From' : 'To'}
        account={counterpart}
        name={formatCounterpartAccount(counterpart)}
        logoUrl={otherLogos.size === 1 ? otherLogos.values().next().value : undefined}
      />
      <ChevronRight
        className='col-start-3 row-start-2 size-4 self-center text-muted-foreground'
        aria-hidden='true'
      />
    </Link>
  ) : (
    <div className='min-w-0 py-3 text-sm text-muted-foreground sm:row-span-4'>
      {isExchange ? 'Other side not matched' : 'Other side not in your connected accounts'}
    </div>
  );
  return (
    <section aria-label='Money movement' className='border-b py-5'>
      <h2 className='text-card-title'>
        {isExchange ? 'One currency to another' : 'Between your accounts'}
      </h2>
      <div className='mt-3 flex flex-col sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-x-5 sm:gap-y-1'>
        {incoming ? other : own}
        <ArrowRight
          className='hidden size-5 self-center text-muted-foreground sm:row-span-4 sm:block'
          aria-hidden='true'
        />
        <ArrowDown className='ml-2.5 size-5 text-muted-foreground sm:hidden' aria-hidden='true' />
        {incoming ? own : other}
      </div>
      {isExchange && (
        <p className='mt-2 text-sm text-muted-foreground'>
          {transaction.exchangeRate
            ? formatBankTransactionExchangeRate(transaction)
            : 'Exchange rate unavailable'}
        </p>
      )}
      <p className='mt-4 flex items-start gap-2 text-sm text-muted-foreground'>
        <Check className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
        {transaction.cashFlowTreatment === 'INTERNAL'
          ? 'Excluded from income and spending'
          : transaction.cashFlowTreatment === 'INCOME'
            ? 'Counts toward income'
            : transaction.cashFlowTreatment === 'EXPENSE'
              ? 'Counts toward spending'
              : 'Cash-flow treatment unknown'}
      </p>
      {isExchange && transaction.categorySource === 'MANUAL' && (
        <dl className='mt-4'>
          <BankTransactionCategorySelect transaction={transaction} />
        </dl>
      )}
    </section>
  );
}

function MovementAccount({
  label,
  account,
  name,
  logoUrl,
}: {
  label: 'From' | 'To';
  account: Pick<BankTransactionCounterpart, 'bankName' | 'currency' | 'amount'>;
  name: string;
  logoUrl?: string;
}) {
  const bank = `${account.bankName} · ${account.currency}`;
  return (
    <>
      <p
        data-testid='movement-label'
        className='col-start-2 row-start-1 text-label text-muted-foreground'
      >
        {label}
      </p>
      <BankLogo
        bank={{name: account.bankName, logoUrl}}
        className='col-start-1 row-span-2 row-start-2 size-10 self-start'
      />
      <p
        data-testid='movement-account'
        className='col-start-2 row-start-2 min-w-0 font-medium wrap-anywhere'
      >
        {name}
      </p>
      {bank !== name && (
        <p
          data-testid='movement-bank'
          className='col-start-2 row-start-3 text-sm wrap-anywhere text-muted-foreground'
        >
          {bank}
        </p>
      )}
      <p
        data-testid='movement-amount'
        className='col-start-2 row-start-4 min-w-0 numeric text-sm font-medium wrap-anywhere [&>span]:whitespace-normal'
      >
        <CurrencyAmount amount={Number(account.amount)} currency={account.currency} />
      </p>
    </>
  );
}

function Recurring({transaction}: {transaction: BankTransaction}) {
  const [expanded, setExpanded] = useState(false);
  const asOf = useLocalDate();
  const {data: recurring, isError, refetch} = useGetBankTransactionRecurring(transaction.id, asOf);
  const historyId = `recurring-history-${transaction.id}`;
  if (isError)
    return (
      <div className='flex items-center gap-2 py-2 text-sm text-muted-foreground'>
        <span>Recurring details unavailable.</span>
        <Button variant='ghost' size='sm' onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  if (!recurring) return null;
  return (
    <section className='border-b py-2' data-testid='recurring-fold'>
      <Button
        variant='ghost'
        size='sm'
        aria-expanded={expanded}
        aria-controls={historyId}
        onClick={() => setExpanded(!expanded)}
        className='-ml-3 justify-start text-muted-foreground max-sm:h-11'
      >
        <ChevronRight
          className={`transition-transform motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
          aria-hidden='true'
        />
        Recurring payment
      </Button>
      <p className='mb-2 pl-6 text-sm text-muted-foreground'>
        {RECURRING_CADENCE_LABELS[recurring.cadence]} ·{' '}
        {recurring.status === 'ENDED'
          ? 'Ended'
          : `Next expected ${formatBankTransactionDate(recurring.nextExpectedDate)}`}
      </p>
      {expanded && (
        <div id={historyId} className='pb-4 pl-6'>
          <p className='mb-3 text-label text-muted-foreground'>Recent payments</p>
          {recurring.payments.map((payment) => (
            <div key={payment.id} className='flex h-[60px] items-center gap-3 border-t'>
              <MerchantLogoTile transaction={transaction} className='size-9' />
              <span className='min-w-0 flex-1 text-sm'>
                <span className='block'>
                  {formatBankTransactionDate(payment.transactionDate || payment.bookingDate)}
                </span>
                {payment.id === transaction.id && (
                  <span className='mt-0.5 block text-label text-muted-foreground'>
                    This payment
                  </span>
                )}
              </span>
              <span className='numeric text-sm'>
                <CurrencyAmount amount={Number(payment.amount)} currency={payment.currency} />
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TransferSetting({transaction}: {transaction: BankTransaction}) {
  const {updateBankTransactionOwnTransfer, isPending} = useUpdateBankTransactionOwnTransfer();
  const [expanded, setExpanded] = useState(false);
  const own = Boolean(transaction.ownTransfer);
  return (
    <div>
      <Button
        variant='ghost'
        size='sm'
        aria-expanded={expanded}
        aria-controls={`transfer-settings-${transaction.id}`}
        onClick={() => setExpanded(!expanded)}
        className='w-full justify-start px-0 text-muted-foreground max-sm:h-11'
      >
        <ChevronRight
          aria-hidden='true'
          className={`transition-transform motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
        />
        Transfer settings
      </Button>
      {expanded && (
        <div id={`transfer-settings-${transaction.id}`} className='space-y-3 pt-3 pb-2'>
          <p className='text-sm text-muted-foreground'>
            {own
              ? 'This payment is recognised as movement between your own accounts.'
              : 'Mark this as an own transfer to exclude it from income and spending.'}
          </p>
          <div className='flex flex-wrap gap-2'>
            <Button
              variant='outline'
              disabled={isPending}
              onClick={() =>
                void updateBankTransactionOwnTransfer({
                  id: transaction.id,
                  override: own ? 'UNMARKED' : 'MARKED',
                  counterpartId: transaction.ownTransfer?.counterpart?.id,
                }).catch(() => undefined)
              }
            >
              {isPending ? 'Saving…' : own ? 'Not my own transfer' : 'Mark as own transfer'}
            </Button>
            {transaction.ownTransferOverride && (
              <Button
                variant='ghost'
                disabled={isPending}
                onClick={() =>
                  void updateBankTransactionOwnTransfer({id: transaction.id, override: null}).catch(
                    () => undefined,
                  )
                }
              >
                Use automatic recognition
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
