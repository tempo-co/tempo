import type {BankAccount, BankConnection} from '@tempo/contracts';

import {accountSubline} from '@/features/banking/utils/bank-account-name';
import {isFileConnection} from '@/features/banking/utils/bank-sync-status';
import {cn} from '@/utils/cn';

/** Imported files are named for what they are; a bank by its name. */
export function connectionName(connection: BankConnection) {
  return isFileConnection(connection) ? 'Imported files' : connection.aspspName;
}

/** Where the account is and how its data arrives: `ABN AMRO · Current account · ••1234 · live sync`. */
export function accountSource(account: BankAccount, connection: BankConnection) {
  const files = isFileConnection(connection);
  return [
    !files && connection.aspspName,
    accountSubline(account) || account.currency,
    files ? 'statement files' : 'live sync',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A headline balance's classes: one line, a size smaller once it runs past 12 characters, so a figure such as
 * "-€1,234,567,890.12" stays whole on a 320px phone instead of breaking after its sign.
 */
export function headlineFigure(text: string) {
  return cn(
    'numeric font-semibold tracking-tight whitespace-nowrap',
    text.length > 12 ? 'text-2xl' : 'text-3xl',
  );
}
