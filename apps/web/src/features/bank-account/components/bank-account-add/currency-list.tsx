import {useVirtualizer} from '@tanstack/react-virtual';
import {Check} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {ScrollArea} from '@/components/ui/scroll-area';
import {cn} from '@/utils/cn';

import {Currency} from '../../types/currency';
import {CurrencyDisplay} from './currency-display';

type CurrencyListProps = {
  currencies: Currency[] | undefined;
  setOpen: (open: boolean) => void;
  setSelectedCurrency: (currency: Currency | null) => void;
  selectedCurrency: string | null;
};

export function CurrencyList({
  currencies,
  setOpen,
  setSelectedCurrency,
  selectedCurrency,
}: CurrencyListProps) {
  const [query, setQuery] = useState<string>('');

  const filteredCurrencies = useMemo(() => {
    if (!currencies) return [];
    return currencies.filter(
      (c) =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.code.toLowerCase().includes(query.toLowerCase()),
    );
  }, [currencies, query]);

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: filteredCurrencies.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 5,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [filteredCurrencies, rowVirtualizer]);

  return (
    <Command>
      <CommandInput
        placeholder={`Search ${currencies?.length} supported currencies...`}
        disabled={!currencies}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No supported currencies found.</CommandEmpty>
        <ScrollArea onWheel={(e) => e.stopPropagation()}>
          <div className='max-h-[250px] overflow-auto' ref={parentRef}>
            <CommandGroup
              style={{height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative'}}
            >
              {filteredCurrencies &&
                rowVirtualizer.getVirtualItems().map((virtualItem) => {
                  const currency = filteredCurrencies[virtualItem.index];
                  return (
                    <CommandItem
                      key={currency.code}
                      value={`${currency.code} ${currency.name}`}
                      className='mr-2 flex items-center justify-between'
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualItem.size}px`,
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                      onSelect={() => {
                        setSelectedCurrency(currency);
                        setOpen(false);
                      }}
                    >
                      <CurrencyDisplay currency={currency} className='pl-1' />
                      <Check
                        className={cn(
                          'ml-2 h-4 w-4',
                          selectedCurrency === currency.code ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                    </CommandItem>
                  );
                })}
            </CommandGroup>
          </div>
        </ScrollArea>
      </CommandList>
    </Command>
  );
}
