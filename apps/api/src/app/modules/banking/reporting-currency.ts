import type {EntityManager} from 'typeorm';

import type {Account} from '@modules/account/account.entity';

/** What the money services need to know about an owner's reporting currency. */
export type ReportingOwner = Pick<Account, 'id' | 'baseCurrency' | 'baseCurrencyRevision' | 'baseAmountsRevision'>;

/**
 * The currency an owner's combined totals are in, or null while they have none: no reporting currency yet, or one
 * that just changed and whose amounts the conversion job has not finished a pass for. Money responses label their
 * figures with this, so a figure is never shown in a currency its amounts are not in.
 */
export function totalsCurrency(owner: ReportingOwner): string | null {
	return owner.baseCurrencyRevision === owner.baseAmountsRevision ? owner.baseCurrency : null;
}

/**
 * A money response read for `owner`, with every `baseCurrency` in it cleared when the owner's reporting currency
 * changed after `owner` was read: its amounts may then be in either currency. Call it once the amounts are read.
 */
export async function settleTotalsCurrency<T>(manager: EntityManager, owner: ReportingOwner, response: T): Promise<T> {
	if (totalsCurrency(owner) === null || !namesCurrency(response)) return response;
	const [current] = (await manager.query(
		`SELECT "baseCurrency", "baseCurrencyRevision" FROM "accounts" WHERE "id" = $1`,
		[owner.id],
	)) as Array<Pick<ReportingOwner, 'baseCurrency' | 'baseCurrencyRevision'>>;
	const unchanged =
		current?.baseCurrency === owner.baseCurrency && current.baseCurrencyRevision === owner.baseCurrencyRevision;
	return unchanged ? response : (withoutCurrency(response) as T);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && (value.constructor === Object || value.constructor === undefined);

function namesCurrency(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(namesCurrency);
	if (!isRecord(value)) return false;
	return Object.entries(value).some(
		([key, entry]) => (key === 'baseCurrency' && entry !== null) || namesCurrency(entry),
	);
}

function withoutCurrency(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutCurrency);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [key, key === 'baseCurrency' ? null : withoutCurrency(entry)]),
	);
}

const LOCK_KEY = `hashtext('reporting-currency:' || $1)`;

/**
 * Taken first in every transaction that writes converted amounts (`amountInBaseCurrency`): sync and import writes, the
 * conversion job. A change of reporting currency takes it exclusively ({@link lockReportingCurrencyForChange}), so it
 * waits for those writers to commit and then clears what they wrote, and they wait for it and then read the new
 * currency. Taken any later, after the transaction has locked transaction rows, it could deadlock with a change.
 */
export async function lockReportingCurrencyForAmountWrites(manager: EntityManager, ownerId: string): Promise<void> {
	await manager.query(`SELECT pg_advisory_xact_lock_shared(${LOCK_KEY})`, [ownerId]);
}

/** Taken first by a transaction that sets or changes an owner's reporting currency. */
export async function lockReportingCurrencyForChange(manager: EntityManager, ownerId: string): Promise<void> {
	await manager.query(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`, [ownerId]);
}
