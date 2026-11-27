import type {ReportingCurrency} from '@wisp/contracts';
import {Check, Search} from 'lucide-react';
import {useState} from 'react';

import {Input} from '@/components/ui/input';
import {ScrollArea} from '@/components/ui/scroll-area';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';

import {currencyLabel, matchesCurrency} from '../utils/currency-names';

const ROW =
  'grid h-auto min-h-12 w-full grid-cols-[1rem_minmax(0,1fr)] items-center justify-start gap-3 rounded-md px-2 py-2 text-left text-body font-normal hover:bg-accent/60 hover:text-foreground focus-visible:-outline-offset-2 disabled:opacity-60 data-[state=on]:bg-accent/60 data-[state=on]:text-foreground';

type CurrencyListProps = {
  settings: Pick<ReportingCurrency, 'options' | 'connectedCurrencies'>;
  value: string | null;
  onSelect: (currency: string) => void;
  disabled?: boolean;
};

/** Every currency the owner can choose, their accounts' first, searchable by code and name. */
export function CurrencyList({settings, value, onSelect, disabled}: CurrencyListProps) {
  const [query, setQuery] = useState('');
  const own = settings.options.filter((code) => settings.connectedCurrencies.includes(code));
  const other = settings.options.filter((code) => !own.includes(code));
  const groups = [
    {label: 'Your accounts', codes: own.filter((code) => matchesCurrency(code, query))},
    {label: 'Other currencies', codes: other.filter((code) => matchesCurrency(code, query))},
  ].filter((group) => group.codes.length > 0);

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <label className='relative mb-2 block'>
        <span className='sr-only'>Search currencies</span>
        <Search
          aria-hidden='true'
          className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground'
        />
        <Input
          type='search'
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Search by code or name'
          autoComplete='off'
          enterKeyHint='search'
          className='h-11 pl-9'
          data-testid='currency-search'
        />
      </label>
      <ScrollArea type='auto' className='-mx-2 min-h-0 flex-1'>
        {groups.length === 0 ? (
          <p className='px-4 py-8 text-center text-body-small text-muted-foreground'>
            No currency called “{query}”
          </p>
        ) : (
          // Clear of the scrollbar on the right, so it never touches a row.
          <div className='grid gap-3 pr-5 pl-2'>
            {groups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h3 className='px-2 pb-1 text-body-small font-medium text-muted-foreground'>
                  {group.label}
                </h3>
                <ToggleGroup
                  type='single'
                  orientation='vertical'
                  aria-label={group.label}
                  value={value ?? ''}
                  disabled={disabled}
                  // Choosing the current currency again keeps it.
                  onValueChange={(code) => {
                    if (code) onSelect(code);
                  }}
                  className='grid gap-0'
                >
                  {group.codes.map((code) => (
                    <ToggleGroupItem key={code} value={code} className={ROW}>
                      <span aria-hidden='true'>
                        {code === value && <Check className='size-4' />}
                      </span>
                      <span className='min-w-0 truncate'>{currencyLabel(code)}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </section>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
