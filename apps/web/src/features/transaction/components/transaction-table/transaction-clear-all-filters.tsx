import {useNavigate} from '@tanstack/react-router';

import {Button} from '@/components/ui/button';

import {TransactionFilterParams} from '../../types/search-params';

type TransactionClearAllFiltersButtonProps = {
  setFilters: React.Dispatch<React.SetStateAction<TransactionFilterParams>>;
  variant?: 'link' | 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
};

export function TransactionClearAllFiltersButton({
  setFilters,
  variant,
  size,
  className,
}: TransactionClearAllFiltersButtonProps) {
  const navigate = useNavigate({from: '/transactions'});

  const handleClear = async () => {
    await navigate({
      search: (prev) => ({
        ...prev,
        categories: undefined,
        startedAt: undefined,
        bankAccountIds: undefined,
      }),
    });
    setFilters((prev) => ({...prev, categories: [], startedAt: undefined, bankAccountIds: []}));
  };

  return (
    <Button variant={variant} size={size} className={className} onClick={handleClear}>
      Clear filters
    </Button>
  );
}
