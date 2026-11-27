import {BANK_ACCOUNT_ALIAS_MAX_LENGTH, type BankImportPreview} from '@wisp/contracts';
import {useId} from 'react';

import {Badge} from '@/components/ui/badge';
import {Input} from '@/components/ui/input';
import {accountSubline} from '@/features/banking/utils/bank-account-name';

import {formatDateRange, plural} from '../utils/import-format';

/**
 * What Check what we found lists: one block per account the drop goes to, its name in a field to rename it, marked
 * New when the import creates it and Matched when it is already in Wisp, with its rows' count and days.
 */
export function FoundAccounts({
  preview,
  names,
  onName,
}: {
  preview: BankImportPreview;
  /** What each account's field holds, in the preview's order. */
  names: readonly string[];
  onName: (index: number, name: string) => void;
}) {
  const id = useId();
  const range = formatDateRange(preview.dateFrom, preview.dateTo);
  return (
    <div className='grid grid-cols-1 gap-3'>
      <p className='text-body text-pretty text-muted-foreground'>
        {plural(preview.rowCount, 'transaction')}
        {range && ` from ${range}`}. Rename an account if you like.
      </p>
      <ul className='grid grid-cols-1 gap-2'>
        {preview.accounts.map((account, index) => {
          const field = `${id}-${index}`;
          const created = account.id === null;
          const accountRange = formatDateRange(account.dateFrom, account.dateTo);
          return (
            <li
              key={account.id ?? `new-${index}`}
              data-testid='bank-import-found-account'
              className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-lg border p-3'
            >
              <label htmlFor={field} className='sr-only'>
                Name of account {index + 1}
              </label>
              <Input
                id={field}
                autoComplete='off'
                maxLength={BANK_ACCOUNT_ALIAS_MAX_LENGTH}
                value={names[index] ?? ''}
                aria-describedby={`${field}-detail`}
                onChange={(event) => onName(index, event.target.value)}
              />
              <Badge variant='secondary'>{created ? 'New' : 'Matched'}</Badge>
              <p
                id={`${field}-detail`}
                className='col-span-2 text-body-small wrap-anywhere text-muted-foreground'
              >
                {[
                  account.bankName,
                  accountSubline(account),
                  account.currency,
                  plural(account.rowCount, 'transaction'),
                  accountRange,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          );
        })}
      </ul>
      <p className='text-body-small text-muted-foreground'>
        You can undo this import from Accounts.
      </p>
    </div>
  );
}
