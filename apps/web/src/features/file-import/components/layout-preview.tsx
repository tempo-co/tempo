import {
  BANK_IMPORT_CURRENCIES,
  type BankImportLayoutPreviewRow,
  type BankImportLayoutProposal,
} from '@tempo/contracts';
import {CalendarCheck, FileText} from 'lucide-react';
import {useId} from 'react';

import {CurrencyAmount} from '@/components/shared/currency-amount';
import {LoadErrorState} from '@/components/shared/state-message';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {formatBankTransactionCompactDate} from '@/features/banking/utils/formatters';
import {getCurrencyFormatter} from '@/utils/format-currency';

import {formatCount, formatDateRange, plural} from '../utils/import-format';
import {OTHER_BANK, dateCheckCopy, mappingInWords, previewRowTitle} from '../utils/layout-mapping';
import {IMPORT_TILE} from './file-choice';

/** The shared 60px row shape, as a plain row: preview rows open nothing. */
const ROW = 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3';

/**
 * A proposed layout read through the owner's own file: how it reads the columns, the first and last rows as they
 * would be stored, the totals, and the bank and currency the owner confirms it with. The bank is picked from the
 * owner's banks, or typed after Other.
 */
export function LayoutPreview({
  proposal,
  banks,
  bankChoice,
  onBankChoice,
  otherBankName,
  onOtherBankName,
  bankError,
  currency,
  onCurrency,
  disabled,
}: {
  proposal: BankImportLayoutProposal;
  /**
   * The banks to pick from, sorted (`useBankImportBanks`): `pending` while they load, or the failed load's error, which
   * takes the picker's place with Try again.
   */
  banks: readonly string[] | 'pending' | {error: unknown; retry: () => unknown};
  /** One of `banks`, `OTHER_BANK`, or empty while none is picked. */
  bankChoice: string;
  onBankChoice: (value: string) => void;
  otherBankName: string;
  onOtherBankName: (value: string) => void;
  /** Why the API refused the name, shown under the bank. */
  bankError: string | null;
  currency: string;
  onCurrency: (value: string) => void;
  disabled: boolean;
}) {
  const {preview, mapping, dateCheck, currencyNeeded} = proposal;
  const bankField = useId();
  const otherBankField = useId();
  const failed = typeof banks !== 'string' && 'error' in banks ? banks : null;
  const listed = typeof banks === 'string' || failed ? [] : (banks as readonly string[]);
  const currencyField = useId();
  const bankHint = useId();
  const range = formatDateRange(preview.dateFrom, preview.dateTo);
  // A file that states no currency previews in the default one; the owner's choice shows at once.
  const rowCurrency = (row: BankImportLayoutPreviewRow) =>
    currencyNeeded ? currency : row.currency;
  const hiddenRows = preview.rowCount - preview.firstRows.length - preview.lastRows.length;
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
        <Alert variant='warning' data-testid='bank-import-date-check'>
          <CalendarCheck aria-hidden='true' />
          <AlertDescription className='text-foreground'>
            {dateCheckCopy(dateCheck)}. Check this matches your bank&apos;s statement before you
            continue.
          </AlertDescription>
        </Alert>
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
          {hiddenRows > 0 && (
            <li className='py-2 text-center text-xs text-muted-foreground'>
              {formatCount(hiddenRows)} more
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
        {failed ? (
          <LoadErrorState
            size='section'
            title="Couldn't load your banks"
            error={failed.error}
            onRetry={failed.retry}
          />
        ) : (
          <div className='grid gap-1.5'>
            <Label htmlFor={bankField}>Bank</Label>
            <Select
              value={banks === 'pending' ? '' : bankChoice}
              onValueChange={onBankChoice}
              disabled={disabled || banks === 'pending'}
            >
              <SelectTrigger
                id={bankField}
                className='max-sm:h-11'
                aria-busy={banks === 'pending' ? true : undefined}
                aria-invalid={bankError && bankChoice !== OTHER_BANK ? true : undefined}
                aria-describedby={bankChoice === OTHER_BANK ? undefined : bankHint}
              >
                <SelectValue
                  placeholder={banks === 'pending' ? 'Loading your banks…' : 'Choose a bank'}
                />
              </SelectTrigger>
              <SelectContent>
                {listed.map((bank) => (
                  <SelectItem key={bank} value={bank}>
                    {bank}
                  </SelectItem>
                ))}
                {listed.length > 0 && <SelectSeparator />}
                <SelectItem value={OTHER_BANK}>Other</SelectItem>
              </SelectContent>
            </Select>
            {banks !== 'pending' && bankChoice === OTHER_BANK && (
              <>
                <Label htmlFor={otherBankField} className='mt-2.5'>
                  Bank name
                </Label>
                <Input
                  id={otherBankField}
                  value={otherBankName}
                  maxLength={60}
                  autoComplete='off'
                  disabled={disabled}
                  aria-invalid={bankError ? true : undefined}
                  aria-describedby={bankHint}
                  onChange={(event) => onOtherBankName(event.target.value)}
                />
              </>
            )}
            {bankError ? (
              <p id={bankHint} role='alert' className='text-xs text-destructive'>
                {bankError}
              </p>
            ) : (
              <p id={bankHint} className='text-xs text-muted-foreground'>
                Files of this layout are listed under this name.
              </p>
            )}
          </div>
        )}
        {currencyNeeded && (
          <div className='grid gap-1.5'>
            <Label htmlFor={currencyField}>Currency</Label>
            <Select value={currency} onValueChange={onCurrency} disabled={disabled}>
              <SelectTrigger id={currencyField} className='max-sm:h-11'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([...BANK_IMPORT_CURRENCIES, proposal.defaultCurrency])]
                  .sort()
                  .map((code) => (
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
