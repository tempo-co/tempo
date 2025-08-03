import {ChevronDown} from 'lucide-react';
import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  ResponsivePicker,
  ResponsivePickerContent,
  ResponsivePickerTrigger,
} from '@/components/ui/responsive-picker';
import {cn} from '@/utils/cn';

import {useGetCurrencies} from '../../api/use-get-currencies';
import {Currency} from '../../types/currency';
import {CurrencyDisplay} from './currency-display';
import {CurrencyList} from './currency-list';

type CurrencyPickerProps = {
  onChange: (currency: string) => void;
  isPending?: boolean;
  error?: boolean;
};

export function CurrencyPicker({onChange, isPending, error}: CurrencyPickerProps) {
  const [open, setOpen] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | null>();

  const {currencies, isPending: isCurrenciesPending} = useGetCurrencies();

  const handleSetSelectedCurrency = (currency: Currency | null) => {
    setSelectedCurrency(currency);
    if (currency) {
      onChange(currency.code);
    }
    setOpen(false);
  };

  return (
    <ResponsivePicker open={open} onOpenChange={setOpen} modal={false}>
      <ResponsivePickerTrigger asChild>
        <Button
          variant='outline'
          disabled={isPending || isCurrenciesPending}
          className={cn('w-full justify-start px-3', error && 'border-destructive')}
          role='combobox'
          aria-expanded={open}
        >
          <div className='flex w-full items-center justify-between'>
            {selectedCurrency ? (
              <CurrencyDisplay currency={selectedCurrency} showName={false} />
            ) : (
              <p className='text-muted-foreground'>Select a currency</p>
            )}
            <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
          </div>
        </Button>
      </ResponsivePickerTrigger>
      <ResponsivePickerContent className='w-[--radix-popover-trigger-width] p-0' align='start'>
        <div className='mt-4 border-t md:mt-0 md:border-t-0'>
          <CurrencyList
            currencies={currencies}
            setOpen={setOpen}
            setSelectedCurrency={handleSetSelectedCurrency}
            selectedCurrency={selectedCurrency?.code ?? null}
          />
        </div>
      </ResponsivePickerContent>
    </ResponsivePicker>
  );
}
