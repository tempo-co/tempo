import type {BankImportSummary} from '@tempo/contracts';
import {CheckCheck} from 'lucide-react';

import {StateMessage} from '@/components/shared/state-message';
import {cn} from '@/utils/cn';

import {
  formatCount,
  formatDateRange,
  formatShortDate,
  isNothingNew,
  nothingNewCopy,
} from '../utils/import-format';
import {ImportBalancePrompts} from './account-balance';
import {importAccountName, useKnownAccounts} from './use-known-accounts';

/** What one import did: its counts, the dates it covered and the accounts it went to. */
export function ImportSummaryBody({summary}: {summary: BankImportSummary}) {
  const known = useKnownAccounts();
  const range = formatDateRange(summary.dateFrom, summary.dateTo);
  const counts = [
    {label: 'New transactions', value: summary.rowsAdded},
    {label: 'Already in Tempo', value: summary.rowsAlreadyPresent},
    ...(summary.rowsDoubtful > 0
      ? [{label: 'Need a look', value: summary.rowsDoubtful, attention: true}]
      : []),
  ];

  return (
    <div className='grid grid-cols-1 gap-4' data-testid='bank-import-summary'>
      {isNothingNew(summary) ? (
        <StateMessage size='section' icon={CheckCheck} {...nothingNewCopy(summary)} />
      ) : (
        <dl className='divide-y overflow-hidden rounded-card border bg-card'>
          {counts.map(({label, value, attention}) => (
            <div
              key={label}
              className='flex min-h-11 items-center justify-between gap-4 px-4 py-2.5'
            >
              <dt className='text-sm'>{label}</dt>
              <dd className={cn('numeric text-sm', attention && 'text-warning')}>
                {formatCount(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {range && <p className='text-sm text-muted-foreground'>{range}</p>}
      {summary.accounts.length > 0 && (
        <section aria-labelledby='bank-import-went-to' className='grid grid-cols-1 gap-1.5'>
          <h3 id='bank-import-went-to' className='text-label text-muted-foreground'>
            Went to
          </h3>
          <ul className='grid grid-cols-1 gap-1'>
            {summary.accounts.map((account) => (
              <li
                key={account.id}
                className='flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm wrap-anywhere'
              >
                <span className='min-w-0'>
                  {importAccountName(account, known)} · {account.currency}
                </span>
                {account.created && (
                  <span className='text-xs text-muted-foreground'>New account</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ImportBalancePrompts summary={summary} />
      {summary.undoneAt && (
        <p className='text-sm text-muted-foreground'>Undone {formatShortDate(summary.undoneAt)}</p>
      )}
    </div>
  );
}
