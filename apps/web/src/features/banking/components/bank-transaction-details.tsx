import * as React from 'react';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {Badge} from '@/components/ui/badge';
import {cn} from '@/utils/cn';

import {BankTransaction} from '../types/bank-transaction';
import {
  formatBankTransactionDate,
  formatBankTransactionDirection,
  formatBankTransactionStatus,
  formatBankTransactionType,
} from '../utils/formatters';

type BankTransactionDetailsProps = {
  transaction: BankTransaction;
};

export function BankTransactionDetails({transaction}: BankTransactionDetailsProps) {
  const transactionTitle = transaction.description || transaction.counterpartyName || 'Transaction';
  const detailsHeadingId = `transaction-${transaction.id}-details-heading`;
  const datesHeadingId = `transaction-${transaction.id}-dates-heading`;
  const accountHeadingId = `transaction-${transaction.id}-account-heading`;
  const classificationHeadingId = `transaction-${transaction.id}-classification-heading`;
  const settlementHeadingId = `transaction-${transaction.id}-settlement-heading`;
  const referenceHeadingId = `transaction-${transaction.id}-reference-heading`;
  const notesHeadingId = `transaction-${transaction.id}-notes-heading`;

  return (
    <div data-testid='bank-transaction-details' className='min-w-0'>
      <section
        aria-label={`${transactionTitle} amount and status`}
        className='border-b px-5 py-5 sm:px-6 sm:py-6'
      >
        <div className='flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between'>
          <div className='min-w-0'>
            <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
              Amount
            </p>
            <p className='mt-1 break-words text-3xl font-medium tracking-tight'>
              <CurrencyAmount amount={Number(transaction.amount)} currency={transaction.currency} />
            </p>
            <p className='mt-1 text-sm text-muted-foreground'>
              {formatBankTransactionDirection(transaction.direction)}
            </p>
          </div>
          <div className='flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-1'>
            <Badge variant='outline'>
              {formatBankTransactionStatus(transaction.transactionStatus)}
            </Badge>
            <span className='text-sm text-muted-foreground'>{transaction.currency}</span>
          </div>
        </div>
      </section>

      <div className='space-y-8 px-5 py-5 sm:px-6 sm:py-6'>
        <section aria-labelledby={detailsHeadingId} data-testid='bank-transaction-details-sections'>
          <h2 id={detailsHeadingId} className='text-lg font-semibold tracking-tight'>
            Transaction details
          </h2>
          <div className='mt-5 grid gap-6 md:grid-cols-2 md:gap-8'>
            <DetailGroup id={datesHeadingId} title='Dates'>
              <Detail
                label='Transaction date'
                value={formatBankTransactionDate(transaction.transactionDate)}
              />
              <Detail
                label='Booking date'
                value={formatBankTransactionDate(transaction.bookingDate)}
              />
              <Detail label='Value date' value={formatBankTransactionDate(transaction.valueDate)} />
            </DetailGroup>

            <DetailGroup id={accountHeadingId} title='Account'>
              <Detail
                label='Bank account'
                value={
                  transaction.bankAccountAlias || transaction.bankAccountName || 'Bank account'
                }
              />
              <Detail label='Bank' value={`${transaction.bankName} (${transaction.bankCountry})`} />
              <Detail label='Counterparty' value={transaction.counterpartyName || '—'} />
            </DetailGroup>

            <DetailGroup id={classificationHeadingId} title='Classification'>
              <Detail
                label='Transaction type'
                value={formatBankTransactionType(transaction.transactionType)}
              />
              <Detail
                label='Direction'
                value={formatBankTransactionDirection(transaction.direction)}
              />
              <Detail
                label='Merchant category code'
                value={transaction.merchantCategoryCode || '—'}
              />
              <Detail
                label='Provider classification'
                value={transaction.providerTransactionDescription || '—'}
              />
            </DetailGroup>

            <DetailGroup id={settlementHeadingId} title='Settlement'>
              <Detail
                label='Balance after transaction'
                value={formatAmount(
                  transaction.balanceAfterAmount,
                  transaction.balanceAfterCurrency,
                )}
              />
              <Detail
                label='Instructed amount'
                value={formatAmount(transaction.instructedAmount, transaction.instructedCurrency)}
              />
              <Detail
                label='Exchange rate'
                value={formatExchangeRate(transaction)}
                className='col-span-2'
              />
            </DetailGroup>

            <DetailGroup id={referenceHeadingId} title='Reference'>
              <Detail
                label='Payment reference'
                value={formatReference(
                  transaction.referenceNumber,
                  transaction.referenceNumberScheme,
                )}
                className='col-span-2'
              />
            </DetailGroup>
          </div>
        </section>

        <section aria-labelledby={notesHeadingId} className='border-t pt-6'>
          <h2 id={notesHeadingId} className='text-lg font-semibold tracking-tight'>
            Notes
          </h2>
          <dl className='mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2'>
            <Detail label='Description' value={transaction.description || '—'} />
            <Detail
              label='Remittance information'
              value={transaction.remittanceInformation || '—'}
            />
          </dl>
        </section>
      </div>
    </div>
  );
}

function DetailGroup({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className='min-w-0'>
      <h3 id={id} className='text-sm font-semibold'>
        {title}
      </h3>
      <dl className='mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:gap-y-4'>{children}</dl>
    </section>
  );
}

function formatAmount(amount: string | null, currency: string | null) {
  if (!amount || !currency) return '—';
  const numericAmount = Number(amount);
  return Number.isFinite(numericAmount)
    ? `${numericAmount.toFixed(2)} ${currency}`
    : `${amount} ${currency}`;
}

function formatExchangeRate(transaction: BankTransaction) {
  if (!transaction.exchangeRate) return '—';
  const numericRate = Number(transaction.exchangeRate);
  const rate = Number.isFinite(numericRate)
    ? numericRate.toFixed(4).replace(/\.?0+$/, '')
    : transaction.exchangeRate;
  const unitCurrency = transaction.exchangeRateUnitCurrency
    ? ` ${transaction.exchangeRateUnitCurrency}`
    : '';
  const rateType = transaction.exchangeRateType ? ` (${transaction.exchangeRateType})` : '';
  return `${rate}${unitCurrency}${rateType}`;
}

function formatReference(referenceNumber: string | null, referenceNumberScheme: string | null) {
  if (!referenceNumber) return '—';
  return referenceNumberScheme ? `${referenceNumber} (${referenceNumberScheme})` : referenceNumber;
}

function Detail({label, value, className}: {label: string; value: string; className?: string}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className='text-xs font-medium text-muted-foreground'>{label}</dt>
      <dd className='mt-1 break-words text-sm [overflow-wrap:anywhere] sm:text-base'>{value}</dd>
    </div>
  );
}
