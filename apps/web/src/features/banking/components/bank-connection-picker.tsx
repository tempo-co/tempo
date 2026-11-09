import {useQuery} from '@tanstack/react-query';
import type {BankConnectionAspsp} from '@tempo/contracts';
import {ArrowLeft, ChevronRight, Loader, Plus, Search} from 'lucide-react';
import {useMemo, useState} from 'react';

import {PendingLabel} from '@/components/shared/pending-label';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';
import {ScrollArea} from '@/components/ui/scroll-area';
import {cn} from '@/utils/cn';

import {bankConnectionsQueryOptions} from '../api/use-get-all-bank-connections';
import {useGetSupportedBanks} from '../api/use-get-supported-banks';
import {BankWordmark} from './bank-wordmark';

type BankConnectionPickerProps = {
  onBankSelect: (bank: BankConnectionAspsp) => void | Promise<void>;
  isStarting: boolean;
  className?: string;
};

type CountryOption = {code: string; label: string; bankCount: number};

type Step = 'bank' | 'country' | 'confirm';

/** Shared row: 56px, full width, the whole row is the target. */
const ROW =
  'grid min-h-14 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';

/**
 * Connecting a bank, one step at a time in one sheet: pick a bank in the likely country (changing it is a step of
 * its own), confirm, then leave for the bank. The sheet keeps one height across steps, so nothing jumps.
 */
export function BankConnectionPicker({
  onBankSelect,
  isStarting,
  className,
}: BankConnectionPickerProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('bank');
  const [countryCode, setCountryCode] = useState<string>();
  const [bank, setBank] = useState<BankConnectionAspsp>();
  const {supportedBanks, isPending, isError, refetch} = useGetSupportedBanks(open);
  // The page already loads the connections; read them without fetching again.
  const {data: bankConnections} = useQuery({...bankConnectionsQueryOptions, enabled: false});

  const countries = useMemo(() => getCountryOptions(supportedBanks ?? []), [supportedBanks]);
  const country =
    countries.find((option) => option.code === countryCode) ??
    likelyCountry(countries, bankConnections?.map((connection) => connection.aspspCountry) ?? []);
  const banks = useMemo(
    () =>
      (supportedBanks ?? [])
        .filter((option) => option.country === country?.code)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [country?.code, supportedBanks],
  );

  // Each opening starts at the bank list; the chosen country stays.
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setStep('bank');
      setBank(undefined);
    }
    setOpen(nextOpen);
  };

  const title =
    step === 'country'
      ? 'Choose a country'
      : step === 'confirm' && bank
        ? `Connect ${bank.name}`
        : 'Connect a bank';

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogTrigger asChild>
        <Button
          className={cn(
            'max-md:h-auto max-md:min-h-11 max-md:max-w-full max-md:whitespace-normal',
            className,
          )}
          disabled={isStarting}
          data-testid='connect-bank-button'
        >
          {isStarting ? <Loader className='animate-slow-spin' /> : <Plus />}
          {isStarting ? 'Connecting…' : 'Connect a bank'}
        </Button>
      </ResponsiveDialogTrigger>
      {/* grid-cols-1 here and on the header: their grid track stays the sheet's width under a truncated title. */}
      <ResponsiveDialogContent
        className='grid-cols-1 sm:max-w-lg'
        data-testid='bank-connection-picker'
      >
        <ResponsiveDialogHeader className='relative grid-cols-1 px-4 text-start md:px-0'>
          {/* Desktop keeps the title clear of the dialog's close button. */}
          <div className='flex min-h-11 items-center gap-1 md:pr-8'>
            {step !== 'bank' && (
              <Button
                variant='ghost'
                size='icon'
                aria-label='Back'
                className='-ml-2 size-11'
                onClick={() => setStep('bank')}
                disabled={isStarting}
              >
                <ArrowLeft />
              </Button>
            )}
            {/* One line, so a long bank name never makes the sheet taller; the name is in full below. */}
            <ResponsiveDialogTitle className='min-w-0 truncate'>{title}</ResponsiveDialogTitle>
          </div>
          <ResponsiveDialogDescription className='sr-only'>
            Pick your bank, then approve access at the bank.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {/* One height for every step and for loading, so the sheet never resizes under a thumb. */}
        <div className='flex h-[min(68dvh,32rem)] min-h-0 flex-col px-4 pb-4 md:px-0 md:pb-0'>
          {isError ? (
            <div
              role='alert'
              className='m-auto grid justify-items-center gap-3 text-center text-sm text-muted-foreground'
            >
              <p>Supported banks are unavailable.</p>
              <Button variant='outline' onClick={() => void refetch()}>
                Try again
              </Button>
            </div>
          ) : isPending ? (
            <div role='status' className='m-auto text-sm text-muted-foreground'>
              <PendingLabel>Loading banks…</PendingLabel>
            </div>
          ) : !country ? (
            <p className='m-auto text-center text-sm text-muted-foreground'>
              No banks are available to connect right now.
            </p>
          ) : step === 'country' ? (
            <CountryStep
              countries={countries}
              selected={country.code}
              onSelect={(code) => {
                setCountryCode(code);
                setStep('bank');
              }}
            />
          ) : step === 'confirm' && bank ? (
            <ConfirmStep
              bank={bank}
              country={country}
              isStarting={isStarting}
              onContinue={() => void onBankSelect(bank)}
            />
          ) : (
            <BankStep
              key={country.code}
              country={country}
              banks={banks}
              onChangeCountry={() => setStep('country')}
              onSelect={(option) => {
                setBank(option);
                setStep('confirm');
              }}
            />
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function BankStep({
  country,
  banks,
  onChangeCountry,
  onSelect,
}: {
  country: CountryOption;
  banks: BankConnectionAspsp[];
  onChangeCountry: () => void;
  onSelect: (bank: BankConnectionAspsp) => void;
}) {
  const [query, setQuery] = useState('');
  const shown = banks.filter((bank) => matches(bank.name, query));
  return (
    <>
      <button
        type='button'
        onClick={onChangeCountry}
        data-testid='bank-connection-country'
        className='mb-3 flex min-h-11 w-full items-center gap-3 rounded-md border px-3 text-left text-sm hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
      >
        <CountryTile code={country.code} />
        <span className='min-w-0 flex-1 truncate'>{country.label}</span>
        <span className='text-primary'>Change</span>
      </button>
      <SearchField
        value={query}
        onChange={setQuery}
        label={`Search banks in ${country.label}`}
        placeholder={`Search ${countOf(banks.length, 'bank', 'banks')}`}
      />
      <List empty={shown.length === 0 ? `No bank called “${query}” in ${country.label}` : null}>
        {shown.map((bank) => (
          <li key={`${bank.country}:${bank.name}`}>
            <button type='button' className={ROW} onClick={() => onSelect(bank)}>
              <BankWordmark bank={bank} />
              <span className='min-w-0 truncate text-sm'>{bank.name}</span>
              <ChevronRight aria-hidden='true' className='size-4 text-muted-foreground' />
            </button>
          </li>
        ))}
      </List>
    </>
  );
}

function CountryStep({
  countries,
  selected,
  onSelect,
}: {
  countries: CountryOption[];
  selected: string;
  onSelect: (code: string) => void;
}) {
  const [query, setQuery] = useState('');
  const shown = countries.filter((country) => matches(`${country.label} ${country.code}`, query));
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
              <span className='min-w-0 truncate text-sm'>{country.label}</span>
              <span className='numeric text-xs text-muted-foreground'>
                {countOf(country.bankCount, 'bank', 'banks')}
              </span>
            </button>
          </li>
        ))}
      </List>
    </>
  );
}

function ConfirmStep({
  bank,
  country,
  isStarting,
  onContinue,
}: {
  bank: BankConnectionAspsp;
  country: CountryOption;
  isStarting: boolean;
  onContinue: () => void;
}) {
  return (
    <div className='flex flex-1 flex-col'>
      <div className='grid flex-1 content-center justify-items-center gap-3 text-center'>
        <BankWordmark bank={bank} size='lg' />
        <p className='text-sm text-muted-foreground'>{country.label}</p>
      </div>
      <div className='grid gap-2'>
        <Button
          onClick={onContinue}
          disabled={isStarting}
          className='h-auto min-h-11 w-full py-2 wrap-anywhere whitespace-normal'
          data-testid='bank-connection-confirm'
        >
          {isStarting ? (
            <PendingLabel>Taking you to {bank.name}…</PendingLabel>
          ) : (
            `Continue to ${bank.name}`
          )}
        </Button>
        <p className='text-center text-xs wrap-anywhere text-muted-foreground'>
          You approve access at {bank.name}, then come back here.
        </p>
      </div>
    </div>
  );
}

const countOf = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

function SearchField({
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

function List({children, empty}: {children: React.ReactNode; empty: string | null}) {
  return (
    <ScrollArea type='auto' className='-mx-2 min-h-0 flex-1'>
      {empty ? (
        <p className='px-4 py-8 text-center text-sm text-muted-foreground'>{empty}</p>
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

const TILE = 'inline-flex h-[21px] w-7 shrink-0 rounded-sm';

/**
 * A country's flag: flat, 28×21, the small corner radius, and a hairline edge so white and pale flags keep their
 * outline on either theme. A code without a flag, or a flag that fails to load, shows the code in the same box.
 */
function CountryTile({code}: {code: string}) {
  const src = FLAGS[`./${code.toLowerCase()}.svg`];
  const [failedSrc, setFailedSrc] = useState<string>();
  if (!src || failedSrc === src)
    return (
      <span
        aria-hidden='true'
        className={cn(
          TILE,
          'items-center justify-center border border-border text-[10px] font-medium text-muted-foreground',
        )}
      >
        {code.toUpperCase()}
      </span>
    );
  return (
    <span
      aria-hidden='true'
      className={cn(
        TILE,
        'relative overflow-hidden after:absolute after:inset-0 after:rounded-sm after:ring-1 after:ring-foreground/15 after:ring-inset',
      )}
    >
      <img src={src} alt='' className='size-full object-cover' onError={() => setFailedSrc(src)} />
    </span>
  );
}

/** Where the owner most likely banks: the country of most existing connections, else the browser's region. */
function likelyCountry(countries: CountryOption[], connected: string[]) {
  const counts = new Map<string, number>();
  for (const code of connected) counts.set(code, (counts.get(code) ?? 0) + 1);
  const fromConnections = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const fromBrowser = navigator.languages
    .map((tag) => {
      try {
        return new Intl.Locale(tag).maximize().region;
      } catch {
        return undefined;
      }
    })
    .find((region) => region && countries.some((country) => country.code === region));
  const code = fromConnections ?? fromBrowser;
  return countries.find((country) => country.code === code) ?? countries[0];
}

function matches(text: string, query: string) {
  const fold = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  return fold(text).includes(fold(query.trim()));
}

function getCountryOptions(banks: BankConnectionAspsp[]): CountryOption[] {
  const counts = new Map<string, number>();
  for (const bank of banks) counts.set(bank.country, (counts.get(bank.country) ?? 0) + 1);
  return [...counts]
    .map(([code, bankCount]) => ({code, label: formatCountry(code), bankCount}))
    .sort((left, right) => left.label.localeCompare(right.label));
}

let regionNames: Intl.DisplayNames | undefined;

function formatCountry(country: string) {
  try {
    regionNames ??= new Intl.DisplayNames(undefined, {type: 'region'});
    return regionNames.of(country) ?? country;
  } catch {
    return country;
  }
}
