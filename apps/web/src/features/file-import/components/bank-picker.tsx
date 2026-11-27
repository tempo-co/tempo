import {type Bank, OTHER_BANK_EXPORT_TEXT, OTHER_BANK_ID} from '@wisp/contracts';
import {ChevronRight} from 'lucide-react';
import {useState} from 'react';

import {TextAction} from '@/components/shared/text-action';
import {useGetSupportedBanks} from '@/features/banking/api/use-get-supported-banks';
import {BankWordmark} from '@/features/banking/components/bank-wordmark';
import {CountryButton, List, ROW, SearchField} from '@/features/banking/components/picker-parts';
import {countryName} from '@/utils/countries';

import {
  UNTESTED_NOTE,
  bankWhere,
  catalogMatch,
  pickedBank,
  pickerBanks,
} from '../utils/picked-bank';

/**
 * The logo of a listed bank, as Connect a bank shows it: the connectable bank of the same name and country. A bank
 * with none, and Another bank, get the plain bank glyph on the same plate; so does every bank while the list loads.
 */
function PickerLogo({bank}: {bank: Bank | null}) {
  const {supportedBanks} = useGetSupportedBanks(true);
  const match = bank && supportedBanks ? catalogMatch(bank, supportedBanks) : undefined;
  // No name, so a missing logo is the bank glyph rather than initials.
  return <BankWordmark bank={{name: '', logo: match?.logo, logoUrl: match?.logoUrl}} />;
}

/**
 * Which bank a statement file is from, for the Add data sheet and the first run: the chosen country's banks, then the
 * banks that serve several countries from one app, then Another bank, which every search keeps. A search covers every
 * country. The list scrolls on its own, and its search is never
 * focused for the owner, so a phone keeps its keyboard closed until the field is tapped.
 */
export function BankPicker({
  country,
  onChangeCountry,
  onPick,
}: {
  country: string;
  onChangeCountry: () => void;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const banks = pickerBanks(country, query);
  const label = countryName(country);
  return (
    // On phones one height whatever the search finds, so nothing jumps under a thumb; on desktop the sheet's own.
    <div className='flex min-h-0 flex-col max-md:h-[min(68dvh,--spacing(128))] md:flex-1'>
      <CountryButton
        code={country}
        label={label}
        onClick={onChangeCountry}
        testId='bank-import-country'
      />
      <SearchField
        value={query}
        onChange={setQuery}
        label='Search banks in every country'
        placeholder='Search all banks'
      />
      <List empty={null}>
        {banks.map((bank) => (
          <li key={bank.id}>
            <BankRow
              bank={bank}
              // The chosen country goes without saying; another one, or several, is named.
              where={bank.country === country && !query.trim() ? null : bankWhere(bank)}
              onPick={onPick}
            />
          </li>
        ))}
        {banks.length === 0 && (
          <li className='px-2 py-6 text-center text-body-small text-muted-foreground'>
            No listed bank called “{query.trim()}”
          </li>
        )}
        <li className='mt-2 border-t pt-2'>
          <button type='button' className={ROW} onClick={() => onPick(OTHER_BANK_ID)}>
            <PickerLogo bank={null} />
            <span className='min-w-0'>
              <span className='block text-body'>Another bank</span>
              <span className='block text-body-small text-muted-foreground'>
                Steps that work for most banks
              </span>
            </span>
            <ChevronRight aria-hidden='true' className='size-4 text-muted-foreground' />
          </button>
        </li>
      </List>
    </div>
  );
}

function BankRow({
  bank,
  where,
  onPick,
}: {
  bank: Bank;
  where: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <button type='button' className={ROW} onClick={() => onPick(bank.id)}>
      <PickerLogo bank={bank} />
      <span className='min-w-0'>
        <span className='block text-body wrap-anywhere'>{bank.name}</span>
        {where && <span className='block text-body-small text-muted-foreground'>{where}</span>}
      </span>
      <ChevronRight aria-hidden='true' className='size-4 text-muted-foreground' />
    </button>
  );
}

/**
 * How to download the picked bank's file, above the file choice: the bank, its numbered steps in its own menu labels
 * and the file to pick. A bank no file of which has been read yet says so; Another bank gets one text for any bank.
 */
export function BankExportSteps({bankId, onChange}: {bankId: string; onChange?: () => void}) {
  const bank = pickedBank(bankId);
  return (
    <section aria-label='Your bank' className='grid grid-cols-1 gap-3'>
      <div className='flex items-center gap-3'>
        <PickerLogo bank={bank} />
        <div className='min-w-0 flex-1'>
          <p className='text-body font-medium wrap-anywhere'>{bank?.name ?? 'Another bank'}</p>
          {bank && <p className='text-body-small text-muted-foreground'>{bankWhere(bank)}</p>}
        </div>
        {onChange && (
          <TextAction type='button' aria-label='Change bank' onClick={onChange} className='-mr-2'>
            Change
          </TextAction>
        )}
      </div>
      {bank ? (
        <>
          <ol
            aria-label={`How to get the file from ${bank.name}`}
            className='grid list-decimal gap-1.5 pl-5 text-body marker:text-muted-foreground'
          >
            {bank.exportSteps.steps.map((step) => (
              <li key={step} className='pl-1 text-pretty'>
                {step}
              </li>
            ))}
          </ol>
          <p className='text-body text-pretty'>
            <span className='font-medium'>The file to pick:</span> {bank.exportSteps.file}
          </p>
          {bank.status === 'unverified' && (
            <p className='text-body-small text-pretty text-muted-foreground'>{UNTESTED_NOTE}</p>
          )}
        </>
      ) : (
        <p className='text-body text-pretty'>{OTHER_BANK_EXPORT_TEXT}</p>
      )}
    </section>
  );
}
