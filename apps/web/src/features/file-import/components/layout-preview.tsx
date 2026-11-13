import type {BankImportLayoutPreviewRow, BankImportLayoutProposal} from '@tempo/contracts';
import {CalendarCheck, FileText} from 'lucide-react';
import {useId} from 'react';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {formatBankTransactionCompactDate} from '@/features/banking/utils/formatters';
import {getCurrencyFormatter} from '@/utils/format-currency';

import {formatCount, formatDateRange, plural} from '../utils/import-format';
import {dateCheckCopy, mappingInWords, previewRowTitle} from '../utils/layout-mapping';
import {IMPORT_TILE} from './file-choice';

/** The shared 60px row shape, as a plain row: preview rows open nothing. */
const ROW = 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3';

/** The currencies offered for a file that states none; the owner's base currency is always among them. */
const CURRENCIES = [
  'AUD',
  'BGN',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'USD',
  'ZAR',
];

/**
 * A proposed layout read through the owner's own file: how it reads the columns, the first and last rows as they
 * would be stored, the totals, and the bank name and currency the owner confirms it with.
 */
export function LayoutPreview({
  proposal,
  bankName,
  onBankName,
  currency,
  onCurrency,
  disabled,
}: {
  proposal: BankImportLayoutProposal;
  bankName: string;
  onBankName: (value: string) => void;
  currency: string;
  onCurrency: (value: string) => void;
  disabled: boolean;
}) {
  const {preview, mapping, dateCheck, currencyNeeded} = proposal;
  const bankField = useId();
  const currencyField = useId();
  const range = formatDateRange(preview.dateFrom, preview.dateTo);
  // A file that states no currency previews in the default one; the owner's choice shows at once.
  const rowCurrency = (row: BankImportLayoutPreviewRow) =>
    currencyNeeded ? currency : row.currency;
  const totals = preview.totals.map((total) => ({
    ...total,
    currency: currencyNeeded ? currency : total.currency,
  }));

  return (
    <div className='grid grid-cols-1 gap-5' data-testid='bank-import-layout-preview'>
      <section aria-labelledby='bank-import-layout-columns' className='grid grid-cols-1 gap-1.5'>
        <h3 id='bank-import-layout-columns' className='text-label text-muted-foreground'>
          How Tempo reads it
        </h3>
        <p className='text-sm text-pretty wrap-anywhere'>{mappingInWords(mapping).join(' · ')}</p>
      </section>

      {dateCheck && (
        <p
          className='flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm'
          data-testid='bank-import-date-check'
        >
          <CalendarCheck aria-hidden='true' className='mt-0.5 size-4 shrink-0 text-warning' />
          <span>
            {dateCheckCopy(dateCheck)}. Check this matches your bank&apos;s statement before you
            continue.
          </span>
        </p>
      )}

      <section aria-labelledby='bank-import-layout-rows' className='grid grid-cols-1 gap-1.5'>
        <h3 id='bank-import-layout-rows' className='text-label text-muted-foreground'>
          {plural(preview.rowCount, 'transaction')}
          {range && ` · ${range}`}
        </h3>
        <ol aria-labelledby='bank-import-layout-rows' className='grid grid-cols-1 divide-y'>
          {preview.firstRows.map((row, index) => (
            <PreviewRow key={`first-${index}`} row={row} currency={rowCurrency(row)} />
          ))}
          {preview.lastRows.length > 0 && (
            <li className='py-2 text-center text-xs text-muted-foreground'>
              {formatCount(preview.rowCount - preview.firstRows.length - preview.lastRows.length)}{' '}
              more
            </li>
          )}
          {preview.lastRows.map((row, index) => (
            <PreviewRow key={`last-${index}`} row={row} currency={rowCurrency(row)} />
          ))}
        </ol>
        <dl className='grid grid-cols-1 gap-1 text-sm' data-testid='bank-import-layout-totals'>
          {totals.flatMap((total) => {
            const formatter = getCurrencyFormatter(total.currency);
            const format = (value: string) => formatter.format(Number(value));
            return [
              <div key={`${total.currency}-in`} className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>Money in</dt>
                <dd className='numeric text-success'>{format(total.moneyIn)}</dd>
              </div>,
              <div key={`${total.currency}-out`} className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>Money out</dt>
                <dd className='numeric'>{format(`-${total.moneyOut}`)}</dd>
              </div>,
            ];
          })}
        </dl>
        {preview.accounts.length > 0 && (
          <p className='text-sm wrap-anywhere text-muted-foreground'>
            Account {preview.accounts.join(', ')}
          </p>
        )}
      </section>

      <div className='grid grid-cols-1 gap-4'>
        <div className='grid gap-1.5'>
          <Label htmlFor={bankField}>Bank</Label>
          <Input
            id={bankField}
            value={bankName}
            maxLength={60}
            autoComplete='off'
            disabled={disabled}
            onChange={(event) => onBankName(event.target.value)}
          />
          <p className='text-xs text-muted-foreground'>
            Files of this layout are listed under this name.
          </p>
        </div>
        {currencyNeeded && (
          <div className='grid gap-1.5'>
            <Label htmlFor={currencyField}>Currency</Label>
            <Select value={currency} onValueChange={onCurrency} disabled={disabled}>
              <SelectTrigger id={currencyField} className='max-sm:h-11'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([...CURRENCIES, proposal.defaultCurrency])].sort().map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className='text-xs text-muted-foreground'>The file doesn&apos;t say.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewRow({row, currency}: {row: BankImportLayoutPreviewRow; currency: string}) {
  const amount = Number(row.amount);
  return (
    <li className={ROW} data-testid='bank-import-layout-row'>
      <span aria-hidden='true' className={IMPORT_TILE}>
        <FileText strokeWidth={2} />
      </span>
      <span className='min-w-0'>
        <span className='block truncate text-sm'>{previewRowTitle(row)}</span>
        <span className='block truncate text-xs text-muted-foreground'>
          {[
            formatBankTransactionCompactDate(row.date),
            row.description && row.counterparty,
            row.balanceAfter !== null &&
              `Balance ${getCurrencyFormatter(currency).format(Number(row.balanceAfter))}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      <span className='grid justify-items-end text-sm'>
        <CurrencyAmount amount={amount} currency={currency} />
        <span className='sr-only'>{amount < 0 ? 'money out' : 'money in'}</span>
      </span>
    </li>
  );
}
