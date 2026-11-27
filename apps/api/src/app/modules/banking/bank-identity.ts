import {bankNameKey} from '@wisp/contracts';
import {FindOperator, Like} from 'typeorm';

/**
 * The bank an account is held at, as `bank_accounts.bankIdentity` records it. A bank's name and its BIC are two kinds
 * of evidence with their own prefix, so they never compare equal. Made only by `nameBankIdentity` and
 * `bicBankIdentity`.
 */
export type BankIdentity = string & {readonly __brand: 'BankIdentity'};

const NAME_PREFIX = 'name:';
const BIC_PREFIX = 'bic:';

/**
 * The bank a name names: a connection's institution as the provider names it, the bank a built-in reader or CSV layout
 * belongs to, or the bank an owner named for a saved layout. Compared ignoring case and spacing (`bankNameKey`), so an
 * owner's "ing" is the ING a connection or a built-in layout names.
 */
export function nameBankIdentity(name: string): BankIdentity {
	return `${NAME_PREFIX}${bankNameKey(name)}` as BankIdentity;
}

/** An institution BIC: institution, country and location, without the branch. */
const INSTITUTION_BIC = /^[A-Z]{6}[A-Z0-9]{2}$/;

/** The bank a statement's BIC names: its institution BIC, as the parsers give it; any other value is refused. */
export function bicBankIdentity(bic: string): BankIdentity {
	if (!INSTITUTION_BIC.test(bic)) throw new Error('Not an institution BIC');
	return `${BIC_PREFIX}${bic}` as BankIdentity;
}

/** The bank name an identity records, case and spacing folded; null for a BIC or none. */
export function identityBankName(identity: BankIdentity | null): string | null {
	return identity?.startsWith(NAME_PREFIX) ? identity.slice(NAME_PREFIX.length) : null;
}

/** A `bankIdentity` condition for the identities that record a bank by name. */
export function namedBankIdentities(): FindOperator<BankIdentity> {
	return Like(`${NAME_PREFIX}%` as BankIdentity);
}

/**
 * The evidence an account keeps when its statements give several, whatever their order: a name (the bank of a
 * bank-specific format or of the owner's layout) over a BIC, and within one kind the value that sorts first.
 */
export function strongerBankIdentity(left: BankIdentity | null, right: BankIdentity | null): BankIdentity | null {
	if (left === null || right === null) return left ?? right;
	const leftIsName = identityBankName(left) !== null;
	if (leftIsName !== (identityBankName(right) !== null)) return leftIsName ? left : right;
	return left <= right ? left : right;
}

/**
 * Whether two pieces of evidence prove two different banks: two names, or two BICs, that differ. Missing evidence,
 * or a name against a BIC, proves nothing.
 */
export function differentBanks(left: BankIdentity | null, right: BankIdentity | null): boolean {
	if (left === null || right === null || left === right) return false;
	return (identityBankName(left) === null) === (identityBankName(right) === null);
}
