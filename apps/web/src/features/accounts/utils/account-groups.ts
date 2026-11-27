import type {BankAccount, BankConnection} from '@wisp/contracts';

import {isFileConnection} from '@/features/banking/utils/bank-sync-status';

import {connectionProblem} from './account-freshness';

export type AccountEntry = {account: BankAccount; connection: BankConnection};
export type Money = {amount: number; currency: string};
export type AccountGroup = {
  type: 'cash' | 'credit';
  label: string;
  accounts: AccountEntry[];
  /** Null when no balance is known or the balances share no currency. */
  total: Money | null;
};

const GROUPS = [
  {type: 'cash', label: 'Cash'},
  {type: 'credit', label: 'Credit'},
] as const;

/**
 * The owner's shown accounts by type (cards are credit, everything else cash), the groups that have accounts in that
 * order. Within a group, accounts of a connection in trouble come first, the rest in the API's order. Hidden accounts
 * are in no group or total; they are `hidden`, in the API's order. A bank connection that holds no account is
 * `unlinked`, so it can still be reconnected or removed.
 */
export function groupAccounts(connections: BankConnection[], now = Date.now()) {
  const all = connections.flatMap((connection) =>
    connection.bankAccounts.map((account) => ({account, connection})),
  );
  const entries = all.filter(({account}) => !account.isHidden);
  const troubled = new Set(
    connections.filter((connection) => connectionProblem(connection, now)).map(({id}) => id),
  );
  const groups: AccountGroup[] = GROUPS.flatMap(({type, label}) => {
    const accounts = entries
      .filter(({account}) => typeOf(account) === type)
      .sort(
        (a, b) => Number(troubled.has(b.connection.id)) - Number(troubled.has(a.connection.id)),
      );
    return accounts.length ? [{type, label, accounts, total: totalOf(accounts)}] : [];
  });
  return {
    groups,
    total: totalOf(entries),
    hidden: all.filter(({account}) => account.isHidden),
    unlinked: connections.filter(
      (connection) => !isFileConnection(connection) && connection.bankAccounts.length === 0,
    ),
  };
}

function typeOf(account: BankAccount): AccountGroup['type'] {
  return account.cashAccountType?.toUpperCase() === 'CARD' ? 'credit' : 'cash';
}

/** The account's balance: the current one, else the bank's primary (or first) reported balance. */
export function accountBalance(account: BankAccount): Money | null {
  const current = account.currentBalanceAmount?.trim();
  if (current && Number.isFinite(Number(current)))
    return {amount: Number(current), currency: account.currency};
  const balances = account.latestBalances ?? [];
  const primary = balances.find((balance) => balance.isPrimary) ?? balances[0];
  if (!primary) return null;
  return {amount: Number(primary.amount), currency: primary.currency};
}

/**
 * The sum of the known balances: in their currency when they share one, otherwise in the reporting currency. Null
 * when none is known, or when mixed currencies lack the reporting currency or a conversion. Zero balances need no
 * conversion.
 */
function totalOf(entries: AccountEntry[]): Money | null {
  const known = entries.flatMap(({account, connection}) => {
    const balance = accountBalance(account);
    return balance ? [{...balance, account, base: connection.baseCurrency}] : [];
  });
  if (known.length === 0) return null;
  // A zero adds nothing, so it neither needs a conversion nor decides the total's currency.
  const counted = known.filter(({amount}) => amount !== 0);
  if (counted.length === 0) return {amount: 0, currency: known[0].currency};
  const cents = (value: number) => Math.round(value * 100);
  const [{currency: first, base}] = counted;
  if (counted.every(({currency}) => currency === first))
    return {
      amount: counted.reduce((sum, {amount}) => sum + cents(amount), 0) / 100,
      currency: first,
    };
  if (!base) return null;
  let sum = 0;
  for (const balance of counted) {
    if (balance.currency === base) sum += cents(balance.amount);
    else if (balance.account.currentBalanceInBaseCurrency)
      sum += cents(Number(balance.account.currentBalanceInBaseCurrency));
    else return null;
  }
  return {amount: sum / 100, currency: base};
}
