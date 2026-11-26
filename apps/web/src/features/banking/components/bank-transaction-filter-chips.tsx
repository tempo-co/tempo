import {useNavigate} from '@tanstack/react-router';
import {X} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {
  type BankTransactionFilterKey,
  useBankTransactionFilterLabels,
} from '@/hooks/use-bank-transaction-filter-labels';

import type {BankTransactionFilterParams} from '../types/bank-transaction';
import {BankTransactionAddFilter} from './bank-transaction-add-filter';

/**
 * Every filter in force as one removable chip, wherever it was set ("+ Add filter" or a link from Home), then
 * "+ Add filter" and, with any chip, Clear. To check is a tab, and the search has its own box, so neither is a chip.
 */
export function BankTransactionFilterChips({
  filters,
  onClear,
}: {
  filters: BankTransactionFilterParams;
  onClear: () => void;
}) {
  const navigate = useNavigate({from: '/transactions/'});
  const chips = useBankTransactionFilterLabels(filters).filter(
    (chip) => chip.key !== 'needsAttention',
  );

  const remove = (key: BankTransactionFilterKey) =>
    void navigate({search: (prev) => ({...prev, [key]: undefined})});

  return (
    <ul
      aria-label='Filters in force'
      className='flex flex-wrap items-center gap-2'
      data-testid='bank-transaction-filter-chips'
    >
      {chips.map(({key, label}) => (
        <li key={key} className='min-w-0'>
          <Button
            variant='secondary'
            size='sm'
            className='h-10 max-w-72 gap-1.5 font-normal sm:h-8'
            aria-label={`Remove filter: ${label}`}
            onClick={() => remove(key)}
          >
            <span className='truncate'>{label}</span>
            <X aria-hidden='true' />
          </Button>
        </li>
      ))}
      <li>
        <BankTransactionAddFilter filters={filters} />
      </li>
      {chips.length > 0 && (
        <li>
          <Button
            variant='ghost'
            size='sm'
            className='h-10 font-normal text-muted-foreground sm:h-8'
            onClick={onClear}
          >
            Clear
          </Button>
        </li>
      )}
    </ul>
  );
}
