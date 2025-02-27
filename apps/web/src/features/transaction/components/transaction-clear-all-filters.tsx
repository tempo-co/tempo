import {useNavigate} from '@tanstack/react-router';

import {Button} from '@/components/ui/button';

import {TransactionFilter} from '../api/use-get-all-transactions';

type TransactionClearAllFiltersProps = {
  setFilters: React.Dispatch<React.SetStateAction<TransactionFilter>>;
};

export function TransactionClearAllFilters({setFilters}: TransactionClearAllFiltersProps) {
  const navigate = useNavigate({from: '/transactions'});

  const handleClear = async () => {
    await navigate({search: (prev) => ({...prev, categories: undefined})});
    setFilters((prev) => ({...prev, categories: []}));
  };

  return (
    <Button variant='secondary' size='sm' className='h-8' onClick={handleClear}>
      Clear all filters
    </Button>
  );
}
