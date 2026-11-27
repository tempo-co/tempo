import {BANK_TRANSACTION_CATEGORIES, BANK_TRANSACTION_UNCATEGORIZED} from '@wisp/contracts';

import {LoadErrorState} from '@/components/shared/state-message';
import {Skeleton} from '@/components/ui/skeleton';
import {useGetBankTransactionBreakdown} from '@/features/dashboard/api/use-get-bank-transaction-breakdown';
import {CategoryName} from '@/features/dashboard/components/category-name';
import {historyFrom} from '@/features/dashboard/utils/overview';
import {useLocalDate} from '@/hooks/use-local-date';

import {SettingsGroup} from './settings-group';

/** Transactions per category over the whole history, in either direction, from the yearly breakdown. */
function useCategoryCounts() {
  const today = useLocalDate();
  const {breakdown, isError, error, refetch} = useGetBankTransactionBreakdown(
    'year',
    'allCategories',
    historyFrom(today),
    today,
    today,
  );
  const counts = new Map<string, number>();
  for (const period of breakdown?.periods ?? [])
    for (const part of period.parts) counts.set(part.key, (counts.get(part.key) ?? 0) + part.count);
  return {counts: breakdown ? counts : null, isError: isError && !breakdown, error, refetch};
}

/** Every category, then rows with none when there are any, each with how many transactions it holds. */
export function CategoryCounts() {
  const {counts, isError, error, refetch} = useCategoryCounts();
  const keys: string[] = [...BANK_TRANSACTION_CATEGORIES];
  if (counts?.get(BANK_TRANSACTION_UNCATEGORIZED)) keys.push(BANK_TRANSACTION_UNCATEGORIZED);

  return (
    <SettingsGroup
      id='categories-heading'
      title='All categories'
      description='The categories your transactions are sorted into, with how many each holds.'
    >
      {isError ? (
        <LoadErrorState title="Couldn't load the category counts" error={error} onRetry={refetch} />
      ) : (
        <ul
          aria-labelledby='categories-heading'
          aria-busy={counts ? undefined : true}
          className='divide-y overflow-hidden rounded-lg border bg-card'
        >
          {keys.map((key) => (
            <li key={key} className='flex min-h-11 items-center justify-between gap-4 px-4 py-2'>
              <CategoryName category={key} className='text-body' />
              {counts ? (
                <span
                  className={
                    counts.get(key)
                      ? 'numeric text-body'
                      : 'numeric text-body text-muted-foreground'
                  }
                >
                  {(counts.get(key) ?? 0).toLocaleString()}
                </span>
              ) : (
                <Skeleton className='h-4 w-8 shrink-0' />
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsGroup>
  );
}
