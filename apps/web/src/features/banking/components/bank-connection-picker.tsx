import {Check, ChevronsUpDown, Loader, Plus} from 'lucide-react';
import {type ReactNode, type WheelEvent as ReactWheelEvent, useMemo, useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog';
import {ScrollArea} from '@/components/ui/scroll-area';
import {cn} from '@/utils/cn';

import {useGetSupportedBanks} from '../api/use-get-supported-banks';
import type {BankConnectionAspsp} from '../types/bank-connection';
import {BankLogo} from './bank-logo';

type BankConnectionPickerProps = {
  onBankSelect: (bank: BankConnectionAspsp) => void | Promise<void>;
  isStarting: boolean;
  className?: string;
};

type CountryOption = {
  code: string;
  label: string;
  bankCount: number;
};

type SearchableSelectorProps<T> = {
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  options: T[];
  selectedOption?: T;
  getKey: (option: T) => string;
  getSearchValue: (option: T) => string;
  renderOption: (option: T, context: 'option' | 'trigger') => ReactNode;
  onSelect: (option: T) => void;
  disabled?: boolean;
  testId: string;
};

export function BankConnectionPicker({
  onBankSelect,
  isStarting,
  className,
}: BankConnectionPickerProps) {
  const [open, setOpen] = useState(false);
  const [selectedCountryCode, setSelectedCountryCode] = useState<string>();
  const [selectedBank, setSelectedBank] = useState<BankConnectionAspsp>();
  const {supportedBanks, isPending, isError, refetch} = useGetSupportedBanks(open);

  const countryOptions = useMemo(() => getCountryOptions(supportedBanks ?? []), [supportedBanks]);
  const selectedCountry = countryOptions.find((country) => country.code === selectedCountryCode);
  const countryBanks = useMemo(
    () =>
      (supportedBanks ?? [])
        .filter((bank) => bank.country === selectedCountryCode)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [selectedCountryCode, supportedBanks],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSelectedCountryCode(undefined);
      setSelectedBank(undefined);
    }
  };

  const selectCountry = (country: CountryOption) => {
    setSelectedCountryCode(country.code);
    setSelectedBank(undefined);
  };

  const selectBank = (bank: BankConnectionAspsp) => {
    setSelectedBank(bank);
    setOpen(false);
    void onBankSelect(bank);
  };

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
          {isStarting ? 'Connecting...' : 'Connect a bank'}
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent
        className='max-h-[85vh] overflow-hidden sm:max-w-xl'
        data-testid='bank-connection-picker'
      >
        <ResponsiveDialogHeader className='text-start'>
          <ResponsiveDialogTitle>Choose a bank</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className='min-h-0 px-0'>
          <div className='grid gap-4'>
            <SearchableSelector
              label='Country'
              placeholder='Select a country'
              searchPlaceholder='Search countries...'
              emptyMessage='No supported countries found.'
              options={countryOptions}
              selectedOption={selectedCountry}
              getKey={(country) => country.code}
              getSearchValue={(country) => `${country.label} ${country.code}`}
              renderOption={(country, context) => (
                <>
                  <CountryFlag country={country.code} />
                  <span className='min-w-0 truncate'>{country.label}</span>
                  {context === 'option' && (
                    <span className='ml-auto shrink-0 text-xs text-muted-foreground'>
                      {country.bankCount} {country.bankCount === 1 ? 'bank' : 'banks'}
                    </span>
                  )}
                </>
              )}
              onSelect={selectCountry}
              disabled={isStarting || isPending || countryOptions.length === 0}
              testId='bank-connection-country-selector'
            />

            <SearchableSelector
              label='Bank'
              placeholder={selectedCountry ? 'Select a bank' : 'Select a country first'}
              searchPlaceholder={`Search banks in ${selectedCountry?.label ?? 'this country'}...`}
              emptyMessage='No supported banks found for this country.'
              options={countryBanks}
              selectedOption={selectedBank}
              getKey={(bank) => `${bank.country}:${bank.name}`}
              getSearchValue={(bank) => bank.name}
              renderOption={(bank) => (
                <>
                  <BankLogo bank={bank} />
                  <span className='min-w-0 truncate'>{bank.name}</span>
                  <span className='ml-auto shrink-0 text-xs text-muted-foreground'>
                    {bank.country}
                  </span>
                </>
              )}
              onSelect={selectBank}
              disabled={isStarting || isPending || !selectedCountry}
              testId='bank-connection-bank-selector'
            />

            {isError && (
              <div
                className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-4'
                role='alert'
              >
                <p className='text-sm text-muted-foreground'>Supported banks are unavailable.</p>
                <Button
                  variant='outline'
                  onClick={() => void refetch()}
                  data-testid='supported-banks-retry'
                >
                  Try again
                </Button>
              </div>
            )}
          </div>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function SearchableSelector<T>({
  label,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  options,
  selectedOption,
  getKey,
  getSearchValue,
  renderOption,
  onSelect,
  disabled = false,
  testId,
}: SearchableSelectorProps<T>) {
  const [open, setOpen] = useState(false);
  const selectedKey = selectedOption ? getKey(selectedOption) : undefined;
  const triggerId = `${testId}-trigger`;

  return (
    <div className='grid gap-2'>
      <label htmlFor={triggerId} className='text-sm font-medium'>
        {label}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={triggerId}
            type='button'
            variant='outline'
            role='combobox'
            aria-expanded={open}
            aria-label={label}
            disabled={disabled}
            data-testid={testId}
            className='h-auto min-h-11 w-full justify-between gap-3 px-3 text-start'
          >
            {selectedOption ? (
              <span className='flex min-w-0 items-center gap-3'>
                {renderOption(selectedOption, 'trigger')}
              </span>
            ) : (
              <span className='truncate text-muted-foreground'>{placeholder}</span>
            )}
            <ChevronsUpDown className='h-4 w-4 shrink-0 opacity-50' aria-hidden='true' />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align='start'
          className='w-[min(32rem,calc(100vw-2rem))] overflow-hidden p-0'
        >
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <ScrollArea className='h-64 max-h-[50vh]'>
              <CommandList
                className='max-h-none overflow-visible p-1'
                onWheel={handleCommandListWheel}
              >
                <CommandEmpty>{emptyMessage}</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => {
                    const key = getKey(option);
                    const isSelected = key === selectedKey;
                    return (
                      <CommandItem
                        key={key}
                        value={getSearchValue(option)}
                        onSelect={() => {
                          onSelect(option);
                          setOpen(false);
                        }}
                        className='min-h-11'
                      >
                        {renderOption(option, 'option')}
                        <Check
                          className={cn(
                            'ml-2 h-4 w-4 shrink-0',
                            isSelected ? 'opacity-100' : 'opacity-0',
                          )}
                          aria-hidden='true'
                        />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </ScrollArea>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function handleCommandListWheel(event: ReactWheelEvent<HTMLDivElement>) {
  const viewport = event.currentTarget.closest<HTMLElement>('[data-radix-scroll-area-viewport]');
  if (!viewport || viewport.scrollHeight <= viewport.clientHeight) return;

  const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
  viewport.scrollTop = Math.max(0, Math.min(viewport.scrollTop + event.deltaY, maxScrollTop));
  event.preventDefault();
}

function CountryFlag({country}: {country: string}) {
  return (
    <span className='text-base leading-none' aria-hidden='true'>
      {countryFlag(country)}
    </span>
  );
}

function getCountryOptions(banks: BankConnectionAspsp[]): CountryOption[] {
  const countryCounts = new Map<string, number>();
  for (const bank of banks) {
    countryCounts.set(bank.country, (countryCounts.get(bank.country) ?? 0) + 1);
  }

  return [...countryCounts.entries()]
    .map(([code, bankCount]) => ({code, label: formatCountry(code), bankCount}))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function countryFlag(country: string) {
  const normalized = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return '🌐';

  return [...normalized]
    .map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397))
    .join('');
}

function formatCountry(country: string) {
  try {
    const label = new Intl.DisplayNames(undefined, {type: 'region'}).of(country);
    return label ?? country;
  } catch {
    return country;
  }
}
