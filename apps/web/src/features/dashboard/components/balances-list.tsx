import {Link} from '@tanstack/react-router';
import {format} from 'date-fns';

import {Card} from '@/components/ui/card';
import {useGetSupportedBanks} from '@/features/banking/api/use-get-supported-banks';
import {BankLogo} from '@/features/banking/components/bank-logo';
import type {BankConnection} from '@/features/banking/types/bank-connection';
import {getAutomaticSyncDetailsForConnection} from '@/features/banking/utils/bank-sync-status';
import {resolveBankAccountLabel} from '@/features/banking/utils/formatters';
import {cn} from '@/utils/cn';

import {parseCalendarDate} from '../utils/drill-links';
import {formatMoney, toCents} from '../utils/money';
import {formatNotSyncedSince} from '../utils/sync-status';

export function BalancesList({
  connections,
  isCurrentMonth,
}: {
  connections: BankConnection[];
  isCurrentMonth: boolean;
}) {
  const {supportedBanks} = useGetSupportedBanks(connections.length > 0);
  const accounts = connections.flatMap((connection) =>
    connection.bankAccounts
      .filter((account) => account.isActive)
      .map((account) => ({account, connection})),
  );
  const baseCurrency = connections[0]?.baseCurrency ?? null;
  const missing = accounts.filter(({account}) => account.currentBalanceInBaseCurrency == null);
  const totalCents = accounts.reduce(
    (sum, {account}) =>
      sum +
      (account.currentBalanceInBaseCurrency == null
        ? 0
        : toCents(account.currentBalanceInBaseCurrency)),
    0,
  );
  return (
    <Card role='region' aria-label='Balances' className='grid min-w-0 gap-4 p-5 sm:p-6'>
      <header className='-my-3 flex flex-wrap items-center justify-between gap-x-2'>
        <h2 className='text-base font-semibold'>
          Balances{' '}
          {!isCurrentMonth && (
            <span className='text-xs font-normal text-muted-foreground'>· today</span>
          )}
        </h2>
        <Link
          to='/bank-connections'
          className='-mr-3 inline-flex min-h-11 items-center px-3 text-xs text-primary underline-offset-4 hover:bg-accent/50 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
        >
          Connections
        </Link>
      </header>
      <ul className='-mx-3 divide-y divide-border/60'>
        {accounts.map(({account, connection}) => {
          const stale = getAutomaticSyncDetailsForConnection(connection)?.isProblem;
          return (
            <li key={account.id}>
              <Link
                to='/bank-connections'
                className='grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-3 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
              >
                <div className='min-w-0'>
                  <div className='flex items-center gap-3'>
                    <BankLogo
                      bank={{
                        name: connection.aspspName,
                        logoUrl: supportedBanks?.find(
                          (bank) =>
                            bank.name === connection.aspspName &&
                            bank.country === connection.aspspCountry,
                        )?.logoUrl,
                      }}
                      className='h-14 w-14'
                      imageClassName='p-1.5'
                      testId='bank-balance-logo'
                    />
                    <div className='min-w-0'>
                      <p className='text-sm font-medium break-words'>{connection.aspspName}</p>
                      <p className='mt-0.5 text-xs break-words text-muted-foreground'>
                        {[account.name, account.alias].filter(Boolean).join(' · ') ||
                          'Bank account'}
                      </p>
                    </div>
                  </div>
                  {stale && (
                    <p className='text-xs text-muted-foreground'>
                      {formatNotSyncedSince(connection)}
                    </p>
                  )}
                </div>
                <div className={cn('text-right text-sm', stale && 'text-muted-foreground')}>
                  <p className='text-right font-mono tabular-nums'>
                    {account.currentBalanceAmount == null
                      ? 'No balance yet'
                      : formatMoney(account.currentBalanceAmount, account.currency)}
                  </p>
                </div>
                {account.currency !== baseCurrency &&
                  account.currentBalanceInBaseCurrency != null &&
                  baseCurrency && (
                    <p className='col-span-2 text-right text-xs text-muted-foreground'>
                      ≈ {formatMoney(account.currentBalanceInBaseCurrency, baseCurrency)}
                      {account.baseCurrencyRateDate &&
                        ` · ECB rate of ${format(parseCalendarDate(account.baseCurrencyRateDate), 'd MMM yyyy')}`}
                    </p>
                  )}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-t pt-4 text-sm'>
        <span className='font-semibold'>Total</span>
        <p className='text-right font-mono tabular-nums'>
          {baseCurrency
            ? `${formatMoney(totalCents / 100, baseCurrency)}${missing.length ? ` excluding ${missing.map(({account}) => resolveBankAccountLabel(account)).join(', ')}` : ''}`
            : 'Base currency not available yet'}
        </p>
        {missing.length > 0 && (
          <p className='col-span-2 text-xs text-muted-foreground'>
            Accounts without a converted balance are left out.
          </p>
        )}
      </div>
    </Card>
  );
}
