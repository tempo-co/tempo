import {
  BANK_IMPORT_ERROR_CODES,
  type BankImportAccountQuestion,
  type BankImportError,
  type BankImportErrorCode,
} from '@tempo/contracts';

import {layoutBank} from './supported-files';

// What one drop may hold, mirrored from the API's apps/api/src/app/modules/file-import/parsers/parse-limits.ts:
// its parse child loads that file alone, so the limits cannot live in the contracts.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_DROP = 20;
const MAX_DROP_BYTES = 25 * 1024 * 1024;

/** A drop of several files is all or nothing, so every refusal says so. */
export const NOTHING_IMPORTED = 'Nothing was imported.';

type RefusalCopy = {title: string; description: string};

/**
 * Copy for each refusal the dialog shows as a refused state. The two account questions ask instead; a file that
 * looks like a bank's CSV export names the bank (`layoutRefusalCopy`).
 */
const REFUSAL_COPY: Record<
  Exclude<BankImportErrorCode, 'layout_not_recognized' | 'mapper_limit_reached'>,
  RefusalCopy
> = {
  unsupported_format: {
    title: "Tempo can't read this file",
    description:
      "It isn't a statement format Tempo knows yet. Supported files lists the formats and bank exports it reads.",
  },
  // A table in no layout Tempo knows, while its columns cannot be worked out here.
  layout_unknown: {
    title: "Tempo doesn't know this file's layout yet",
    description: "It isn't a layout Tempo knows yet.",
  },
  mapper_unavailable: {
    title: "Tempo doesn't know this file's layout yet",
    description: "It isn't a layout Tempo knows yet.",
  },
  layout_not_mappable: {
    title: "Tempo couldn't work out this file's columns",
    description:
      'Nothing was imported. Try another export format from your bank, such as CAMT.053 or MT940.',
  },
  layout_proposal_expired: {
    title: 'This preview has expired',
    description: 'Work out the columns again to import this file.',
  },
  layout_limit_reached: {
    title: 'You have 50 saved layouts',
    description: 'Remove one under Supported files before saving another.',
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
    // The API's MAX_ROWS_PER_DROP.
    description:
      'One import can hold 20,000 transactions. Export shorter periods and import them one after another.',
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

/** A file laid out like a bank's CSV export whose rows do not read as that export's; it already says nothing came in. */
function layoutRefusalCopy(layout: string | undefined): RefusalCopy {
  const bank = layoutBank(layout);
  return {
    title: `This file doesn't look the way ${bank ? `${bank}'s` : "your bank's"} exports usually do`,
    description:
      "Tempo didn't import anything from it. Try exporting it again, or use CAMT.053 or MT940 if your bank offers them.",
  };
}

/** A file in no layout Tempo knows, when its columns can be worked out: the owner is offered that. */
export const MAPPER_COPY: RefusalCopy = {
  title: "Tempo doesn't know this file's layout yet",
  description:
    'Tempo can work out which column is which. It sends the column headings and the shape of a few rows, with letters and digits masked, to its AI service.',
};

/** After the owner said a proposed layout is not right. */
export const LAYOUT_DISCARDED_COPY: RefusalCopy = {
  title: "Tempo didn't import anything",
  description: "This layout isn't supported yet.",
};

const timeFormat = new Intl.DateTimeFormat(undefined, {hour: 'numeric', minute: '2-digit'});

/** The daily limit on working out columns, with when the next one may be asked: today or tomorrow. */
function limitCopy(retryAt: string | undefined, now = new Date()): RefusalCopy {
  const at = retryAt ? new Date(retryAt) : null;
  const when = !at
    ? 'tomorrow'
    : `${at.toDateString() === now.toDateString() ? 'today' : 'tomorrow'} at ${timeFormat.format(at)}`;
  return {
    title: "You've worked out the columns of 5 files today",
    description: `You can work out another file's columns ${when}.`,
  };
}

/** Refusals whose copy already says nothing came in. */
const SAYS_NOTHING_IMPORTED: readonly BankImportErrorCode[] = ['layout_not_mappable'];

/** Refusals worth sending the same files again for, without choosing others. */
const RETRYABLE_CODES: readonly BankImportErrorCode[] = ['account_busy', 'import_busy'];

export type ImportFailure =
  /** The API refused the drop: nothing was written. */
  | {
      kind: 'refused';
      code: BankImportErrorCode;
      title: string;
      description: string;
      retry: boolean;
      /** The file (1-based) whose columns the owner is offered to work out; null when there is no such offer. */
      mapFile: number | null;
    }
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
  if (files.length > MAX_FILES_PER_DROP) return refusal('too_many_files', null);
  const large = files.findIndex((file) => file.size > MAX_FILE_BYTES);
  if (large !== -1) return refusal('file_too_large', large + 1);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  return total > MAX_DROP_BYTES ? refusal('drop_too_large', null) : null;
}

/**
 * What a refused import means for the owner. `fileNames` are the drop's files in the order sent: a refusal
 * names its file by position, and the name is shown when there was more than one to tell apart. With `mapper`
 * on, a table in no layout Tempo knows, or one that only looks like a bank's export, is offered to have its
 * columns worked out.
 */
export function describeRefusal(
  refusal: BankImportError,
  fileNames: readonly string[],
  {mapper = false}: {mapper?: boolean} = {},
): Exclude<ImportFailure, {kind: 'failed'}> {
  if (refusal.accountQuestions && refusal.accountQuestions.length > 0) {
    return {kind: 'question', code: refusal.code, questions: refusal.accountQuestions};
  }
  const mappable =
    mapper &&
    refusal.file !== null &&
    (['layout_unknown', 'layout_not_recognized', 'layout_proposal_expired'] as const).some(
      (code) => code === refusal.code,
    );
  const copy =
    mappable && refusal.code !== 'layout_proposal_expired'
      ? MAPPER_COPY
      : refusal.code === 'layout_not_recognized'
        ? layoutRefusalCopy(refusal.layout)
        : refusal.code === 'mapper_limit_reached'
          ? limitCopy(refusal.retryAt)
          : REFUSAL_COPY[refusal.code];
  const fileName =
    refusal.file !== null && fileNames.length > 1 ? fileNames[refusal.file - 1] : undefined;
  // The layout copy says nothing came in from its file; with other files, the drop's outcome still needs saying.
  const nothingImported =
    (refusal.code === 'layout_not_recognized' && !mappable && !fileName) ||
    SAYS_NOTHING_IMPORTED.includes(refusal.code)
      ? ''
      : ` ${NOTHING_IMPORTED}`;
  return {
    kind: 'refused',
    code: refusal.code,
    title: copy.title,
    description: `${fileName ? `${fileName}: ` : ''}${copy.description}${nothingImported}`,
    retry: RETRYABLE_CODES.includes(refusal.code),
    mapFile: mappable ? refusal.file : null,
  };
}

/** The `accountChoices` key a question is answered with. */
export function accountQuestionKey(question: Pick<BankImportAccountQuestion, 'bank' | 'currency'>) {
  return `${question.bank}:${question.currency}`;
}
