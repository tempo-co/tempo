import {useNavigate} from '@tanstack/react-router';
import {X} from 'lucide-react';

import {Button} from '@/components/ui/button';

import {BankTransactionFilterParams} from '../types/bank-transaction';
import {CATEGORY_STATUS_LABELS} from '../utils/drill-filters';

type DrillFilterKey = 'categoryStatuses' | 'recurringSeriesKey';

function describeDrillFilters(filters: BankTransactionFilterParams) {
  const chips: {key: DrillFilterKey; label: string}[] = [];
  if (filters.categoryStatuses?.length) {
    chips.push({
      key: 'categoryStatuses',
      label: filters.categoryStatuses.map((value) => CATEGORY_STATUS_LABELS[value]).join(' or '),
    });
  }
  if (filters.recurringSeriesKey) {
    chips.push({key: 'recurringSeriesKey', label: 'One recurring payment'});
  }
  return chips;
}

type BankTransactionDrillFiltersProps = {
  filters: BankTransactionFilterParams;
};

/**
 * Categorization-status and recurring-payment drills remain removable chips; neither has a picker.
 */
export function BankTransactionDrillFilters({filters}: BankTransactionDrillFiltersProps) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const chips = describeDrillFilters(filters);
  if (chips.length === 0) return null;

  const removeFilter = (key: DrillFilterKey) =>
    void navigate({search: (prev) => ({...prev, [key]: undefined, pageIndex: 0})});

  return (
    <ul
      aria-label='Filters from Home'
      className='flex flex-wrap items-center gap-2'
      data-testid='bank-transaction-drill-filters'
    >
      {chips.map(({key, label}) => (
        <li key={key}>
          <Button
            variant='secondary'
            size='sm'
            className='h-12 gap-1.5 sm:h-8'
            aria-label={`Remove filter: ${label}`}
            onClick={() => removeFilter(key)}
          >
            {label}
            <X aria-hidden='true' />
          </Button>
        </li>
      ))}
    </ul>
  );
}
