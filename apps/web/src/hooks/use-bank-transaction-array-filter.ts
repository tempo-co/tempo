import {useNavigate} from '@tanstack/react-router';

import {BankTransactionFilterParams} from '@/features/banking/types/bank-transaction';

type ArrayFilterKey = 'bankAccountIds' | 'categories' | 'categorySources' | 'financialEventTypes';

export function useBankTransactionArrayFilter<K extends ArrayFilterKey>(
  filters: BankTransactionFilterParams,
  key: K,
) {
  type Value = NonNullable<BankTransactionFilterParams[K]>[number];
  const navigate = useNavigate({from: '/bank-transactions/'});
  const selectedValues: Value[] = filters[key] ?? [];

  const setSelectedValues = (values: Value[]) =>
    navigate({
      search: (prev) => ({...prev, [key]: values.length === 0 ? undefined : values, pageIndex: 0}),
    });

  const toggle = (value: Value) =>
    setSelectedValues(
      selectedValues.includes(value)
        ? selectedValues.filter((selectedValue) => selectedValue !== value)
        : [...selectedValues, value],
    );

  const reset = () => setSelectedValues([]);

  return {selectedValues, toggle, reset};
}
