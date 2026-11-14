import type {
  BankImportAccountCandidate,
  BankImportAccountQuestion,
  BankImportErrorCode,
} from '@tempo/contracts';

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
  return (
    <div className='grid grid-cols-1 gap-6'>
      {questions.map((question) => {
        const key = accountQuestionKey(question);
        const first = question.candidates[0];
        const options = [
          ...question.candidates.map((candidate) => ({
            value: candidate.bankAccountId,
            title: accountName(candidate),
            detail: candidateDetail(candidate),
          })),
          ...(question.newAccount
            ? [
                {
                  value: NEW_ACCOUNT,
                  title: 'A new account',
                  detail: 'Keeps these transactions separate',
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
                      'grid min-h-14 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-3 py-2 hover:bg-accent/60 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring',
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
