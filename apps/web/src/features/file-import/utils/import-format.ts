import type {BankImportSummary} from '@tempo/contracts';
import {format, isThisYear, isToday, isYesterday, parseISO} from 'date-fns';

const countFormat = new Intl.NumberFormat();

/** A count with the locale's thousands separator. */
export function formatCount(value: number) {
  return countFormat.format(value);
}

/** `1 file`, `3 files`. */
export function plural(count: number, one: string, many = `${one}s`) {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/** A file's size in bytes, KB or MB, as a file list shows it. */
export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${formatCount(bytes)} bytes`;
  if (bytes < 1024 * 1024) return `${formatCount(Math.round(bytes / 1024))} KB`;
  return `${new Intl.NumberFormat(undefined, {maximumFractionDigits: 1}).format(bytes / 1024 / 1024)} MB`;
}

/** The part of a file name kept whole when the name is cut short: its end, where versions and extensions differ. */
export function fileNameTail(name: string) {
  const tailLength = Math.min(12, Math.floor(name.length / 2));
  return {
    head: name.slice(0, name.length - tailLength),
    tail: name.slice(name.length - tailLength),
  };
}

/** A day and month, with the year only when it is not this year: `12 Nov`, `30 Dec 2025`. */
export function formatShortDate(value: string) {
  const date = parseISO(value);
  return format(date, isThisYear(date) ? 'd MMM' : 'd MMM yyyy');
}

/** When an import ran: `Today`, `Yesterday` or a date. */
export function formatImportedDay(value: string) {
  const date = parseISO(value);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return formatShortDate(value);
}

/** The booking dates a drop covers: `1 May – 30 Oct 2026`, with each year when they differ. */
export function formatDateRange(from: string | null, to: string | null) {
  if (!from || !to) return null;
  const start = parseISO(from);
  const end = parseISO(to);
  if (from === to) return format(end, 'd MMM yyyy');
  const sameYear = start.getFullYear() === end.getFullYear();
  return `${format(start, sameYear ? 'd MMM' : 'd MMM yyyy')} – ${format(end, 'd MMM yyyy')}`;
}

export function summaryTitle(summary: Pick<BankImportSummary, 'filesCount'>) {
  return `Imported ${plural(summary.filesCount, 'file')}`;
}

/** Nothing was added and nothing waits for the owner. */
export function isNothingNew(summary: Pick<BankImportSummary, 'rowsAdded' | 'rowsDoubtful'>) {
  return summary.rowsAdded === 0 && summary.rowsDoubtful === 0;
}

export function nothingNewCopy(
  summary: Pick<BankImportSummary, 'filesCount' | 'rowsAlreadyPresent'>,
) {
  const files = summary.filesCount === 1 ? 'this file' : 'these files';
  const count = summary.rowsAlreadyPresent;
  return {
    title: `Nothing new in ${files}`,
    description:
      count === 0
        ? `There are no transactions in ${files}.`
        : count === 1
          ? 'The only transaction is already in Tempo.'
          : `All ${formatCount(count)} transactions are already in Tempo.`,
  };
}

/**
 * An import's first line in the Imports list: `3 files · 212 new`, `1 file · nothing new`. An undone import shows only
 * its files (`1 file`), since the rows it added are gone.
 */
export function importHeadline(
  summary: Pick<BankImportSummary, 'filesCount' | 'rowsAdded' | 'undoneAt'>,
) {
  const files = plural(summary.filesCount, 'file');
  if (summary.undoneAt) return files;
  const added = summary.rowsAdded === 0 ? 'nothing new' : `${formatCount(summary.rowsAdded)} new`;
  return `${files} · ${added}`;
}

/** `3 need a look`, `1 needs a look`. */
export function needALook(count: number) {
  return `${formatCount(count)} ${count === 1 ? 'needs' : 'need'} a look`;
}

/**
 * What undoing an import does, as the API does it: the rows it still owns go (rows bank sync has taken over are
 * no longer its own), and an account it created goes once no other import's rows are in it.
 */
export function undoDescription(
  summary: Pick<BankImportSummary, 'rowsAdded' | 'accounts'>,
  {intoSyncedAccount}: {intoSyncedAccount: boolean},
) {
  const added = summary.rowsAdded;
  const created = summary.accounts.filter((account) => account.created).length;
  return [
    added === 0
      ? 'It added no transactions, so none are removed.'
      : added === 1
        ? 'This removes the transaction it added.'
        : `This removes the ${plural(added, 'transaction')} it added.`,
    intoSyncedAccount && added > 0 && 'Any that bank sync has picked up since then are kept.',
    created === 1 &&
      'The account it created is removed too, unless another import also added transactions to it.',
    created > 1 &&
      'The accounts it created are removed too, unless another import also added transactions to them.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The title of an undone import's summary: `This import was undone today`, `… on 3 Oct`. */
export function undoneTitle(undoneAt: string) {
  const date = parseISO(undoneAt);
  const when = isToday(date)
    ? 'today'
    : isYesterday(date)
      ? 'yesterday'
      : `on ${formatShortDate(undoneAt)}`;
  return `This import was undone ${when}`;
}

/** What undoing an import did, in the past tense of `undoDescription`. */
export function undoneDescription(
  summary: Pick<BankImportSummary, 'rowsAdded'>,
  {intoSyncedAccount}: {intoSyncedAccount: boolean},
) {
  if (summary.rowsAdded === 0) return "It hadn't added any transactions, so none were removed.";
  const removed =
    summary.rowsAdded === 1
      ? 'The transaction it added was removed'
      : 'The transactions it added were removed';
  return intoSyncedAccount
    ? `${removed}, except any that bank sync had picked up by then.`
    : `${removed}.`;
}
