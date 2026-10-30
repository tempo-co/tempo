import {BankTransaction} from '../types/bank-transaction';
import {BankTransactionCounterpartLink} from './bank-transaction-counterpart-link';

type BankTransactionCurrencyExchangeProps = {
  transaction: BankTransaction;
};

/** The other leg of a currency exchange. */
export function BankTransactionCurrencyExchange({
  transaction,
}: BankTransactionCurrencyExchangeProps) {
  const counterpart = transaction.currencyExchangeCounterpart ?? null;

  return (
    // One term/value group keeps the description list valid; visible overflow keeps the focus ring whole.
    <div className='col-span-2 min-w-0' data-testid='bank-transaction-currency-exchange'>
      <dt className='text-xs font-medium text-muted-foreground'>Other side</dt>
      <dd className='mt-1 overflow-visible! text-sm sm:text-base'>
        {counterpart ? (
          <BankTransactionCounterpartLink
            counterpart={counterpart}
            testId='bank-transaction-currency-exchange-counterpart'
          />
        ) : (
          <p>Not matched</p>
        )}
      </dd>
    </div>
  );
}
