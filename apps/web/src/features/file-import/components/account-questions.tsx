import {useQuery} from '@tanstack/react-query';
import type {
  BankImportAccountCandidate,
  BankImportAccountQuestion,
  BankImportErrorCode,
} from '@tempo/contracts';
import {Plus} from 'lucide-react';
import {type ReactNode, useMemo} from 'react';

import {bankLogoKey, useBankLogos} from '@/features/banking/api/use-bank-logos';
import {bankConnectionsQueryOptions} from '@/features/banking/api/use-get-all-bank-connections';
import {
  ACCOUNT_TILE,
  AccountTypeIcon,
  ImportedFilesTile,
} from '@/features/banking/components/account-tiles';
import {type BankArtwork, BankLogo} from '@/features/banking/components/bank-logo';
import {accountName, accountSubline} from '@/features/banking/utils/bank-account-name';
import {cn} from '@/utils/cn';

import {accountQuestionKey} from '../utils/refusal-copy';

/** The `accountChoices` value for the imported-files account of the question's bank and currency. */
export const NEW_ACCOUNT = 'new';

/** The account as the Connections page names it, and where it is. */
const candidateDetail = (candidate: BankImportAccountCandidate) =>
  [accountSubline(candidate), candidate.imported ? 'Imported files' : candidate.bankName]
    .filter(Boolean)
    .join(' · ');

/** The logo of each account's bank by account id, as its Connections card shows it, from the loaded list. */
function useAccountBankArtwork() {
  const {data: connections} = useQuery({...bankConnectionsQueryOptions, enabled: false});
  const logos = useBankLogos(true);
  return useMemo(() => {
    const artwork = new Map<string, BankArtwork | undefined>();
    for (const connection of connections ?? []) {
      const logo = logos[bankLogoKey(connection.aspspName, connection.aspspCountry)];
      for (const account of connection.bankAccounts) artwork.set(account.id, logo);
    }
    return artwork;
  }, [connections, logos]);
}

/**
 * A candidate's leading tile: its bank's logo (imported files: the files tile), as on its Connections card, with
 * the account's type in a small tile on its corner, as on its Connections row.
 */
function CandidateTile({
  candidate,
  artwork,
}: {
  candidate: BankImportAccountCandidate;
  artwork?: BankArtwork;
}) {
  return (
    <span className='relative size-9' data-testid='bank-import-account-tile'>
      {candidate.imported ? (
        <ImportedFilesTile />
      ) : (
        <BankLogo
          bank={{name: candidate.bankName, ...artwork}}
          className='size-9 rounded-md text-xs shadow-none'
          imageClassName='p-1'
        />
      )}
      <span
        aria-hidden='true'
        className={cn(ACCOUNT_TILE, 'absolute -right-1.5 -bottom-1.5 size-5')}
      >
        <AccountTypeIcon type={candidate.cashAccountType} className='size-3' />
      </span>
    </span>
  );
}

/**
 * Which account each statement that names none goes to: one question per bank and currency, each with the
 * accounts it could be, and a new account until the imported-files account of that bank and currency exists (it is
 * then a candidate). Nothing is preselected.
 */
export function AccountQuestions({
  code,
  questions,
  answers,
  onAnswer,
  disabled,
}: {
  code: BankImportErrorCode;
  questions: BankImportAccountQuestion[];
  answers: Record<string, string>;
  onAnswer: (key: string, value: string) => void;
  disabled?: boolean;
}) {
  const artwork = useAccountBankArtwork();
  return (
    <div className='grid grid-cols-1 gap-6'>
      {questions.map((question) => {
        const key = accountQuestionKey(question);
        const first = question.candidates[0];
        const options: Array<{value: string; title: string; detail: string; tile: ReactNode}> = [
          ...question.candidates.map((candidate) => ({
            value: candidate.bankAccountId,
            title: accountName(candidate),
            detail: candidateDetail(candidate),
            tile: (
              <CandidateTile candidate={candidate} artwork={artwork.get(candidate.bankAccountId)} />
            ),
          })),
          ...(question.newAccount
            ? [
                {
                  value: NEW_ACCOUNT,
                  title: 'A new account',
                  detail: 'Keeps these transactions separate',
                  tile: (
                    <span
                      aria-hidden='true'
                      data-testid='bank-import-account-tile'
                      className={cn(ACCOUNT_TILE, 'rounded-md')}
                    >
                      <Plus className='size-4' strokeWidth={1.8} />
                    </span>
                  ),
                },
              ]
            : []),
        ];
        return (
          <fieldset key={key} className='grid min-w-0 grid-cols-1 gap-2' disabled={disabled}>
            <legend className='mb-1 text-sm font-medium'>
              {question.bank} · {question.currency}
            </legend>
            <p className='text-sm text-muted-foreground'>
              {code === 'target_account_unconfirmed' && first
                ? `Few of these transactions match what Tempo already has for ${accountName(first)}.`
                : 'You have more than one account this could be.'}
            </p>
            <div className='divide-y overflow-hidden rounded-md border'>
              {options.map((option) => {
                const checked = answers[key] === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      'grid min-h-15 cursor-pointer grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3 px-3 py-3 hover:bg-accent/60 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring',
                      checked && 'bg-accent/60',
                    )}
                  >
                    <input
                      type='radio'
                      name={`bank-import-account-${key}`}
                      value={option.value}
                      checked={checked}
                      onChange={() => onAnswer(key, option.value)}
                      className='sr-only'
                    />
                    <span
                      aria-hidden='true'
                      className={cn(
                        'grid size-4 place-items-center rounded-full border border-muted-foreground',
                        checked && 'border-primary',
                      )}
                    >
                      {checked && <span className='size-2 rounded-full bg-primary' />}
                    </span>
                    {option.tile}
                    <span className='min-w-0'>
                      <span className='block text-sm wrap-anywhere'>{option.title}</span>
                      <span className='block text-xs wrap-anywhere text-muted-foreground'>
                        {option.detail}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
