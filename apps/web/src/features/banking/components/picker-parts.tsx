/* eslint-disable react-refresh/only-export-components */
import {Search} from 'lucide-react';
import {type ReactNode, useState} from 'react';

import {Input} from '@/components/ui/input';
import {ScrollArea} from '@/components/ui/scroll-area';
import {cn} from '@/utils/cn';
import {matchesSearch} from '@/utils/text-search';

/*
 * The parts the Add data sheet's pickers share (connecting a bank, and the bank a statement file is from): 56px rows,
 * a search field that is never focused for the owner, a scrolling list, and the country row, list and flag.
 */

export type CountryOption = {code: string; label: string; bankCount: number};

/** Shared row shape: 56px, full width. */
export const ROW_SHAPE =
  'grid min-h-14 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left';
/** A list row whose whole width is the target. */
export const ROW = cn(
  ROW_SHAPE,
  'hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
);
export const COUNTRY_SHAPE =
  'mb-3 flex min-h-11 w-full items-center gap-3 rounded-md border px-3 text-left text-body';

export function CountryStep({
  countries,
  selected,
  onSelect,
}: {
  countries: CountryOption[];
  selected: string;
  onSelect: (code: string) => void;
}) {
  const [query, setQuery] = useState('');
  const shown = countries.filter((country) =>
    matchesSearch(`${country.label} ${country.code}`, query),
  );
  return (
    <>
      <SearchField
        value={query}
        onChange={setQuery}
        label='Search countries'
        placeholder={`Search ${countOf(countries.length, 'country', 'countries')}`}
      />
      <List empty={shown.length === 0 ? `No country called “${query}”` : null}>
        {shown.map((country) => (
          <li key={country.code}>
            <button
              type='button'
              className={cn(ROW, country.code === selected && 'bg-accent/60')}
              aria-current={country.code === selected || undefined}
              onClick={() => onSelect(country.code)}
            >
              <CountryTile code={country.code} />
              <span className='min-w-0 truncate text-body'>{country.label}</span>
              <span className='numeric text-body-small text-muted-foreground'>
                {countOf(country.bankCount, 'bank', 'banks')}
              </span>
            </button>
          </li>
        ))}
      </List>
    </>
  );
}

export const countOf = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

export function SearchField({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
}) {
  // Never focused for the user: opening the sheet or changing step leaves the field alone, so no ring shows and
  // phones keep the keyboard closed until it is tapped. Typing starts with a tap, or Tab from the header.
  return (
    <label className='relative mb-2 block'>
      <span className='sr-only'>{label}</span>
      <Search
        aria-hidden='true'
        className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground'
      />
      <Input
        type='search'
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete='off'
        enterKeyHint='search'
        className='h-11 pl-9'
      />
    </label>
  );
}

export function List({children, empty}: {children: ReactNode; empty: string | null}) {
  return (
    <ScrollArea type='auto' className='-mx-2 min-h-0 flex-1'>
      {empty ? (
        <p className='px-4 py-8 text-center text-body-small text-muted-foreground'>{empty}</p>
      ) : (
        // Clear of the scrollbar on the right, so it never touches a row.
        <ul className='grid pr-5 pl-2'>{children}</ul>
      )}
    </ScrollArea>
  );
}

// Every flat 4:3 flag in flag-icons (MIT), by lowercase country code, so any country the provider adds gets its
// flag and none depends on the OS's emoji font. Only the URLs are bundled: a flag downloads when a tile shows it,
// never inlined (`no-inline`), and the offline shell leaves these files out.
const FLAGS = import.meta.glob<string>('./*.svg', {
  base: '/node_modules/flag-icons/flags/4x3/',
  eager: true,
  query: '?url&no-inline',
  import: 'default',
});

export const COUNTRY_TILE = 'inline-flex aspect-4/3 w-7 shrink-0 rounded-sm';

/**
 * A country's flag: flat, 28×21, the small corner radius, and a hairline edge so white and pale flags keep their
 * outline on either theme. A code without a flag, or a flag that fails to load, shows the code in the same box.
 */
export function CountryTile({code}: {code: string}) {
  const src = FLAGS[`./${code.toLowerCase()}.svg`];
  const [failedSrc, setFailedSrc] = useState<string>();
  if (!src || failedSrc === src)
    return (
      <span
        aria-hidden='true'
        className={cn(
          COUNTRY_TILE,
          'items-center justify-center border border-border text-caption font-medium text-muted-foreground',
        )}
      >
        {code.toUpperCase()}
      </span>
    );
  return (
    <span
      aria-hidden='true'
      className={cn(
        COUNTRY_TILE,
        'relative overflow-hidden after:absolute after:inset-0 after:rounded-sm after:ring-1 after:ring-foreground/15 after:ring-inset',
      )}
    >
      <img src={src} alt='' className='size-full object-cover' onError={() => setFailedSrc(src)} />
    </span>
  );
}

/** The chosen country as a row above a list, with Change to choose another. */
export function CountryButton({
  code,
  label,
  onClick,
  testId,
}: {
  code: string;
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      data-testid={testId}
      className={cn(
        COUNTRY_SHAPE,
        'hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      )}
    >
      <CountryTile code={code} />
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      <span className='text-primary'>Change</span>
    </button>
  );
}
