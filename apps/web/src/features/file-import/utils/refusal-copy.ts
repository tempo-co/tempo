import {
  BANK_IMPORT_ERROR_CODES,
  BANK_IMPORT_MAX_DROP_BYTES,
  BANK_IMPORT_MAX_FILES,
  BANK_IMPORT_MAX_FILE_BYTES,
  type BankImportAccountQuestion,
  type BankImportError,
  type BankImportErrorCode,
} from '@tempo/contracts';

/** A drop of several files is all or nothing, so every refusal says so. */
export const NOTHING_IMPORTED = 'Nothing was imported.';

type RefusalCopy = {title: string; description: string};

/** Copy for each refusal the dialog shows as a refused state. The two account questions ask instead. */
const REFUSAL_COPY: Record<BankImportErrorCode, RefusalCopy> = {
  unsupported_format: {
    title: "Tempo can't read this file",
    description:
      "It isn't a statement format Tempo knows yet. Export it from your bank as CAMT.053, MT940 or CSV.",
  },
  legacy_xls_not_supported: {
    title: "Old Excel files aren't supported",
    description: 'Export the same statement as CAMT.053, MT940 or TXT instead.',
  },
  file_too_large: {
    title: 'This file is too large',
    description: 'Export shorter periods and import them together.',
  },
  drop_too_large: {
    title: 'These files are too large together',
    description: 'Import them in smaller batches.',
  },
  archive_too_large: {
    title: 'This file is too large',
    description: 'Export shorter periods and import them together.',
  },
  too_many_files: {
    title: 'Too many files at once',
    description: 'Import them in smaller batches.',
  },
  too_many_rows: {
    title: 'Too many transactions at once',
    description: 'Export shorter periods and import them one after another.',
  },
  parse_failed: {
    title: "This file couldn't be read",
    description: "Something in it doesn't add up. Download it again from your bank and retry.",
  },
  parse_timeout: {
    title: 'Reading this file took too long',
    description: 'Export a shorter period and try again.',
  },
  account_busy: {
    title: 'This bank is syncing right now',
    description: 'Try again in a minute.',
  },
  target_account_mismatch: {
    title: 'This file belongs to a different account',
    description: "Its account or currency doesn't match the one chosen.",
  },
  multiple_bank_connections: {
    title: 'These files belong to more than one bank',
    description: "Import each bank's files separately.",
  },
  import_busy: {
    title: 'Other files are being imported',
    description: 'Try again in a minute.',
  },
  // Asked as a question when the refusal lists what to ask; these cover a refusal with nothing to ask.
  ambiguous_target_account: {
    title: 'This file fits more than one account',
    description: 'More than one of your accounts has the account number this file names.',
  },
  target_account_unconfirmed: {
    title: "This file's account couldn't be confirmed",
    description: 'Few of its transactions match the account it would go to.',
  },
};

/** Refusals worth sending the same files again for, without choosing others. */
const RETRYABLE_CODES: readonly BankImportErrorCode[] = ['account_busy', 'import_busy'];

export type ImportFailure =
  /** The API refused the drop: nothing was written. */
  | {kind: 'refused'; code: BankImportErrorCode; title: string; description: string; retry: boolean}
  /** The API asks which account each statement that names none goes to. */
  | {kind: 'question'; code: BankImportErrorCode; questions: BankImportAccountQuestion[]}
  /** No refusal: the request failed. `toasted` failures were already reported by the api wrapper. */
  | {kind: 'failed'; error: unknown; toasted: boolean};

/**
 * The refusal in an error reply, if it is one. A proxy in front of the API refuses an upload over its size limit,
 * which only the drop's files together can reach, with a 413 that is not the API's.
 */
export function toBankImportError(status: number, body: unknown): BankImportError | null {
  if (
    typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    typeof body.code === 'string' &&
    (BANK_IMPORT_ERROR_CODES as readonly string[]).includes(body.code)
  )
    return body as BankImportError;
  return status === 413 ? {statusCode: 413, message: '', code: 'drop_too_large', file: null} : null;
}

/**
 * The refusal the API would answer a choice of files with for its size alone, so it is told before uploading: more
 * files than a drop holds, a file too large (by its position), or files too large together.
 */
export function refuseBySize(files: readonly Pick<File, 'size'>[]): BankImportError | null {
  // The status the API answers each with.
  const refusal = (code: BankImportErrorCode, file: number | null): BankImportError => ({
    statusCode: code === 'too_many_files' ? 422 : 413,
    message: '',
    code,
    file,
  });
  if (files.length > BANK_IMPORT_MAX_FILES) return refusal('too_many_files', null);
  const large = files.findIndex((file) => file.size > BANK_IMPORT_MAX_FILE_BYTES);
  if (large !== -1) return refusal('file_too_large', large + 1);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  return total > BANK_IMPORT_MAX_DROP_BYTES ? refusal('drop_too_large', null) : null;
}

/**
 * What a refused import means for the owner. `fileNames` are the drop's files in the order sent: a refusal
 * names its file by position, and the name is shown when there was more than one to tell apart.
 */
export function describeRefusal(
  refusal: BankImportError,
  fileNames: readonly string[],
): Exclude<ImportFailure, {kind: 'failed'}> {
  if (refusal.accountQuestions && refusal.accountQuestions.length > 0) {
    return {kind: 'question', code: refusal.code, questions: refusal.accountQuestions};
  }
  const copy = REFUSAL_COPY[refusal.code];
  const fileName =
    refusal.file !== null && fileNames.length > 1 ? fileNames[refusal.file - 1] : undefined;
  return {
    kind: 'refused',
    code: refusal.code,
    title: copy.title,
    description: `${fileName ? `${fileName}: ` : ''}${copy.description} ${NOTHING_IMPORTED}`,
    retry: RETRYABLE_CODES.includes(refusal.code),
  };
}

/** The `accountChoices` key a question is answered with. */
export function accountQuestionKey(question: Pick<BankImportAccountQuestion, 'bank' | 'currency'>) {
  return `${question.bank}:${question.currency}`;
}
