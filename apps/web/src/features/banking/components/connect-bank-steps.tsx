import {useQuery, useQueryClient} from '@tanstack/react-query';
import type {BankConnectionAspsp} from '@tempo/contracts';
import {ChevronRight, CircleAlert, CircleX, Loader, Plus, Search} from 'lucide-react';
import {type MouseEvent, useMemo, useState} from 'react';

import {PendingLabel} from '@/components/shared/pending-label';
import {StepFrame} from '@/components/shared/step-frame';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Skeleton} from '@/components/ui/skeleton';
import {cn} from '@/utils/cn';
import {browserRegion, countryName} from '@/utils/countries';
import {matchesSearch} from '@/utils/text-search';

import {bankConnectionsQueryOptions} from '../api/use-get-all-bank-connections';
import {supportedBanksQueryOptions, useGetSupportedBanks} from '../api/use-get-supported-banks';
import {BankWordmark} from './bank-wordmark';
import {
  COUNTRY_SHAPE,
  COUNTRY_TILE,
  CountryButton,
  type CountryOption,
  CountryStep,
  List,
  ROW,
  ROW_SHAPE,
  SearchField,
  countOf,
} from './picker-parts';

/** A bank as the hand-off to it remembers it, enough to try it again. */
export type ConnectingBank = Pick<BankConnectionAspsp, 'name' | 'country'>;

/** Where connecting a bank is: the bank list (in the likely country), another country, the hand-off, or the return. */
export type ConnectStep =
  | {kind: 'bank'}
  | {kind: 'country'}
  | {kind: 'confirm'; bank: BankConnectionAspsp}
  /** Back from the bank without a connection; `bank` is the one left for, when this tab remembers it. */
  | {kind: 'returned'; result: 'cancelled' | 'error'; bank: ConnectingBank | null};

/**
 * Connecting a bank, one step at a time in the Add data sheet: pick a bank in the likely country (changing it is a
 * step of its own), confirm, then leave for the bank; it sends the owner back with the result. On phones the steps
 * keep one height, so nothing jumps under a thumb.
 */
export function ConnectBankSteps({
  step,
  onStep,
  countryCode,
  onCountryCode,
  onBack,
  onConnect,
  isStarting,
  onImportInstead,
}: {
  step: ConnectStep;
  onStep: (step: ConnectStep) => void;
  /** The country the owner chose; it stays while the sheet closes and opens again. */
  countryCode: string | undefined;
  onCountryCode: (code: string) => void;
  /** From the bank list back to what the sheet offered first. */
  onBack?: () => void;
  onConnect: (bank: ConnectingBank) => void | Promise<void>;
  isStarting: boolean;
  /** Offered when the bank failed to connect, while file import is on. */
  onImportInstead?: () => void;
}) {
  const {supportedBanks, isPending, isError, refetch} = useGetSupportedBanks(true);
  // The pages already load the connections; read them without fetching again.
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

  if (step.kind === 'returned')
    return (
      <ReturnedStep
        step={step}
        onPickBank={() => onStep({kind: 'bank'})}
        onConnect={onConnect}
        isStarting={isStarting}
        onImportInstead={onImportInstead}
      />
    );

  const title =
    step.kind === 'country'
      ? 'Choose a country'
      : step.kind === 'confirm'
        ? `Connect ${step.bank.name}`
        : 'Connect a bank';
  const back =
    step.kind === 'bank' ? onBack : isStarting ? undefined : () => onStep({kind: 'bank'});

  return (
    <StepFrame
      title={title}
      truncateTitle
      srDescription='Pick your bank, then approve access at the bank.'
      onBack={back}
      backLabel={step.kind === 'bank' ? 'Back to Add data' : 'Back'}
      scroll={false}
      body={
        // On phones one height for every step and for loading; on desktop the sheet's own height.
        <div className='flex min-h-0 flex-col max-md:h-[min(68dvh,--spacing(128))] md:flex-1'>
          {isError ? (
            <div
              role='alert'
              className='m-auto grid justify-items-center gap-3 text-center text-body-small text-muted-foreground'
            >
              <p>Supported banks are unavailable.</p>
              <Button variant='outline' onClick={() => void refetch()}>
                Try again
              </Button>
            </div>
          ) : isPending ? (
            <BankStepSkeleton />
          ) : !country ? (
            <p className='m-auto text-center text-body-small text-muted-foreground'>
              No banks are available to connect right now.
            </p>
          ) : step.kind === 'country' ? (
            <CountryStep
              countries={countries}
              selected={country.code}
              onSelect={(code) => {
                onCountryCode(code);
                onStep({kind: 'bank'});
              }}
            />
          ) : step.kind === 'confirm' ? (
            <ConfirmStep
              bank={step.bank}
              country={country}
              isStarting={isStarting}
              onContinue={() => void onConnect(step.bank)}
            />
          ) : (
            <BankStep
              key={country.code}
              country={country}
              banks={banks}
              // Once the user searches or picks, a late guess from connected banks no longer moves the country.
              onInteract={() => onCountryCode(country.code)}
              onChangeCountry={() => onStep({kind: 'country'})}
              onSelect={(option) => {
                onCountryCode(country.code);
                onStep({kind: 'confirm', bank: option});
              }}
            />
          )}
        </div>
      }
    />
  );
}

/** Connect a bank on a page: it opens the steps in the Add data sheet, loading the banks once pointed at. */
export function ConnectBankButton({
  onClick,
  isStarting,
  className,
}: {
  onClick: (event: MouseEvent<HTMLElement>) => void;
  isStarting: boolean;
  className?: string;
}) {
  const queryClient = useQueryClient();
  return (
    <Button
      className={cn(
        'max-md:h-auto max-md:min-h-11 max-md:max-w-full max-md:whitespace-normal',
        className,
      )}
      disabled={isStarting}
      onClick={onClick}
      // Start loading the banks when the pointer or focus reaches the button, so they are often ready by the click.
      onPointerEnter={() => void queryClient.prefetchQuery(supportedBanksQueryOptions)}
      onFocus={() => void queryClient.prefetchQuery(supportedBanksQueryOptions)}
      data-testid='connect-bank-button'
    >
      {isStarting ? <Loader className='animate-slow-spin' /> : <Plus />}
      {isStarting ? 'Connecting…' : 'Connect a bank'}
    </Button>
  );
}

/** Back from the bank's site without a connection: what happened, and the ways on from there. */
function ReturnedStep({
  step,
  onPickBank,
  onConnect,
  isStarting,
  onImportInstead,
}: {
  step: Extract<ConnectStep, {kind: 'returned'}>;
  onPickBank: () => void;
  onConnect: (bank: ConnectingBank) => void | Promise<void>;
  isStarting: boolean;
  onImportInstead?: () => void;
}) {
  const {result, bank} = step;
  const cancelled = result === 'cancelled';
  const name = bank?.name ?? 'your bank';
  const Icon = cancelled ? CircleAlert : CircleX;
  return (
    <StepFrame
      title={
        cancelled ? `You didn't finish at ${name}` : `${bank?.name ?? 'Your bank'} didn't connect`
      }
      srDescription='Nothing was connected.'
      body={
        <Alert role='alert' variant={cancelled ? 'warning' : 'destructive'}>
          <Icon aria-hidden='true' />
          <AlertTitle>
            {cancelled ? 'Nothing was connected' : "Couldn't finish the connection"}
          </AlertTitle>
          <AlertDescription className='wrap-anywhere'>
            {cancelled
              ? `You left ${bank ? `${bank.name}'s` : "your bank's"} site before approving access.`
              : 'Nothing was connected. Try again in a few minutes.'}
          </AlertDescription>
        </Alert>
      }
      footer={
        <>
          {!cancelled && onImportInstead && (
            <Button
              variant='ghost'
              disabled={isStarting}
              onClick={onImportInstead}
              className='order-3 md:order-1 md:mr-auto md:-ml-4'
            >
              Import a file instead
            </Button>
          )}
          <Button
            variant={bank ? 'outline' : 'default'}
            disabled={isStarting}
            onClick={onPickBank}
            className='order-2'
          >
            {bank ? 'Pick another bank' : 'Pick a bank'}
          </Button>
          {bank && (
            <Button
              disabled={isStarting}
              onClick={() => void onConnect(bank)}
              className='order-1 h-auto min-h-8 wrap-anywhere whitespace-normal max-md:min-h-11 md:order-3'
            >
              {isStarting ? <PendingLabel>Taking you to {bank.name}…</PendingLabel> : 'Try again'}
            </Button>
          )}
        </>
      }
    />
  );
}

function BankStep({
  country,
  banks,
  onInteract,
  onChangeCountry,
  onSelect,
}: {
  country: CountryOption;
  banks: BankConnectionAspsp[];
  onInteract: () => void;
  onChangeCountry: () => void;
  onSelect: (bank: BankConnectionAspsp) => void;
}) {
  const [query, setQuery] = useState('');
  const shown = banks.filter((bank) => matchesSearch(bank.name, query));
  return (
    <>
      <CountryButton
        code={country.code}
        label={country.label}
        onClick={onChangeCountry}
        testId='bank-connection-country'
      />
      <SearchField
        value={query}
        onChange={(value) => {
          onInteract();
          setQuery(value);
        }}
        label={`Search banks in ${country.label}`}
        placeholder={`Search ${countOf(banks.length, 'bank', 'banks')}`}
      />
      <List empty={shown.length === 0 ? `No bank called “${query}” in ${country.label}` : null}>
        {shown.map((bank) => (
          <li key={`${bank.country}:${bank.name}`}>
            <button type='button' className={ROW} onClick={() => onSelect(bank)}>
              <BankWordmark bank={bank} />
              <span className='min-w-0 truncate text-body'>{bank.name}</span>
              <ChevronRight aria-hidden='true' className='size-4 text-muted-foreground' />
            </button>
          </li>
        ))}
      </List>
    </>
  );
}

const SKELETON_NAME_WIDTHS = ['w-32', 'w-40', 'w-24', 'w-36', 'w-28', 'w-44', 'w-32', 'w-24'];

/** The bank step's shape while the banks load: its static labels, with placeholders where the data goes. */
function BankStepSkeleton() {
  return (
    <div role='status' className='flex min-h-0 flex-1 flex-col'>
      <span className='sr-only'>Loading banks…</span>
      <div
        aria-hidden='true'
        className='flex min-h-0 flex-1 flex-col'
        data-testid='bank-step-skeleton'
      >
        <div className={COUNTRY_SHAPE}>
          <Skeleton className={COUNTRY_TILE} />
          <Skeleton className='h-4 w-24' />
          <span className='ml-auto text-muted-foreground'>Change</span>
        </div>
        <div className='relative mb-2'>
          <Search className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input disabled tabIndex={-1} placeholder='Search banks' className='h-11 pl-9' />
        </div>
        {/* The list's own insets, without its scroll area: the rows past the sheet's end are cut off. */}
        <div className='-mx-2 min-h-0 flex-1 overflow-hidden'>
          <ul className='grid pr-5 pl-2'>
            {SKELETON_NAME_WIDTHS.map((width, index) => (
              <li key={index} className={ROW_SHAPE}>
                <Skeleton className='h-9 w-28' />
                <Skeleton className={cn('h-4 max-w-full', width)} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
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
        <p className='text-body-small text-muted-foreground'>{country.label}</p>
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
        <p className='text-center text-body-small wrap-anywhere text-muted-foreground'>
          You approve access at {bank.name}, then come back here.
        </p>
      </div>
    </div>
  );
}

/** Where the owner most likely banks: the country of most existing connections, else the browser's region. */
function likelyCountry(countries: CountryOption[], connected: string[]) {
  const counts = new Map<string, number>();
  for (const code of connected) counts.set(code, (counts.get(code) ?? 0) + 1);
  const fromConnections = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const fromBrowser = browserRegion((region) =>
    countries.some((country) => country.code === region),
  );
  const code = fromConnections ?? fromBrowser;
  return countries.find((country) => country.code === code) ?? countries[0];
}

function getCountryOptions(banks: BankConnectionAspsp[]): CountryOption[] {
  const counts = new Map<string, number>();
  for (const bank of banks) counts.set(bank.country, (counts.get(bank.country) ?? 0) + 1);
  return [...counts]
    .map(([code, bankCount]) => ({code, label: countryName(code), bankCount}))
    .sort((left, right) => left.label.localeCompare(right.label));
}
