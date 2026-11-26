import type {BankConnection, BankImportSummary} from '@tempo/contracts';
import {differenceInCalendarDays, format, isSameYear, parseISO} from 'date-fns';

import {
  getAutomaticSyncProblemForConnection,
  isConnectedBank,
  isConsentEndingSoon,
  isFileConnection,
  isReauthorizationRequired,
  isSyncInProgress,
} from '@/features/banking/utils/bank-sync-status';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** A statement file whose last day is further back than this is due for a newer one. */
export const STALE_FILE_DAYS = 35;

/**
 * How current an account's numbers are, as its row and page say it: "File up to 20 Nov · imported today",
 * "Synced 2 h ago", or what is wrong and the one action that fixes it.
 */
export type AccountFreshness = {
  /** `warning` is amber: a stale file, a long quiet sync or a connection in trouble. */
  tone: 'ok' | 'warning' | 'quiet';
  label: string;
  /** Shown after the label, muted. */
  detail?: string;
  /** `import`: Import newer; `reconnect`: Reconnect the bank. */
  action: 'import' | 'reconnect' | null;
  /** Still working, with time to act, as opposed to already stopped. */
  soon?: true;
};

/**
 * The freshness of one account of `connection`. A file account runs up to the newest end date of the imports that
 * wrote to it and are not undone; `imports` is undefined while the deployment has file import off or the list has
 * not answered. A synced account runs up to its connection's last successful sync.
 */
export function accountFreshness({
  connection,
  accountId,
  imports,
  now,
}: {
  connection: BankConnection;
  accountId: string;
  imports?: BankImportSummary[];
  now: number;
}): AccountFreshness {
  if (isFileConnection(connection)) return fileFreshness(accountId, imports, now);
  const problem = connectionProblem(connection, now);
  if (problem) return problem;
  const synced = connection.lastSuccessfulSyncAt;
  if (!synced)
    return {
      tone: 'quiet',
      label: isSyncInProgress(connection) ? 'Syncing…' : 'Not synced yet',
      action: null,
    };
  const ago = now - Date.parse(synced);
  return {tone: ago > DAY ? 'warning' : 'ok', label: `Synced ${timeAgo(ago)}`, action: null};
}

/** What is wrong with a bank connection, if anything, worded for an account row; null for imported files. */
export function connectionProblem(
  connection: BankConnection,
  now: number,
): AccountFreshness | null {
  if (isFileConnection(connection)) return null;
  if (!isConnectedBank(connection))
    return {
      tone: 'warning',
      label: 'Not connected',
      detail: 'the bank did not finish authorizing',
      action: 'reconnect',
    };
  const lastSuccess = connection.lastSuccessfulSyncAt;
  if (isReauthorizationRequired(connection))
    return {
      tone: 'warning',
      label: 'Access expired',
      detail: lastSuccess
        ? `no updates since ${shortDate(lastSuccess, now)}`
        : 'automatic sync has stopped',
      action: 'reconnect',
    };
  if (isConsentEndingSoon(connection) && connection.consentValidUntil)
    return {
      tone: 'warning',
      label: `Access ends ${daysUntil(connection.consentValidUntil, now)}`,
      detail: 'reconnect to keep syncing',
      action: 'reconnect',
      soon: true,
    };
  const sync = getAutomaticSyncProblemForConnection(connection);
  if (sync)
    return {
      tone: 'warning',
      label: sync.title.replace('Automatic sync needs attention', 'Sync failed'),
      detail: [
        lastSuccess && `no updates since ${shortDate(lastSuccess, now)}`,
        'retries on its own',
      ]
        .filter(Boolean)
        .join(' · '),
      action: null,
    };
  return null;
}

function fileFreshness(
  accountId: string,
  imports: BankImportSummary[] | undefined,
  now: number,
): AccountFreshness {
  if (!imports) return {tone: 'quiet', label: 'From statement files', action: null};
  let newest: BankImportSummary | null = null;
  for (const summary of imports) {
    if (summary.undoneAt || !summary.dateTo) continue;
    if (!summary.accounts.some((account) => account.id === accountId)) continue;
    if (!newest || summary.dateTo > newest.dateTo!) newest = summary;
  }
  if (!newest) return {tone: 'quiet', label: 'No statement file yet', action: 'import'};
  const label = `File up to ${shortDate(newest.dateTo!, now)}`;
  const age = differenceInCalendarDays(now, parseISO(newest.dateTo!));
  if (age > STALE_FILE_DAYS)
    return {tone: 'warning', label, detail: `${age} days ago`, action: 'import'};
  return {
    tone: 'ok',
    label,
    detail: `imported ${importedDay(newest.createdAt, now)}`,
    action: null,
  };
}

/** `just now`, `5 min ago`, `2 h ago`, `3 days ago`. */
function timeAgo(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / MINUTE));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function importedDay(value: string, now: number) {
  const days = differenceInCalendarDays(now, new Date(value));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return shortDate(value, now);
}

function daysUntil(value: string, now: number) {
  const days = Math.ceil((Date.parse(value) - now) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** `20 Nov`, with the year when it is not this one. A plain date reads as that local day. */
function shortDate(value: string, now: number) {
  const date = value.length === 10 ? parseISO(value) : new Date(value);
  return format(date, isSameYear(date, now) ? 'd MMM' : 'd MMM yyyy');
}
