import {bankNameKey} from '@tempo/contracts';

/**
 * The bank an account is held at, as `bank_accounts.bankIdentity` records it. A bank's name and its BIC are two kinds
 * of evidence with their own prefix, so they never compare equal.
 */
const NAME_PREFIX = 'name:';
const BIC_PREFIX = 'bic:';

/**
 * The bank a name names: a connection's institution as the provider names it, the bank a built-in reader or CSV layout
 * belongs to, or the bank an owner named for a saved layout. Compared ignoring case and spacing (`bankNameKey`), so an
 * owner's "ing" is the ING a connection or a built-in layout names.
 */
export function nameBankIdentity(name: string): string {
	return `${NAME_PREFIX}${bankNameKey(name)}`;
}

/** The bank a statement's BIC names: its first eight characters, the institution without its branch. */
export function bicBankIdentity(bic: string): string {
	return `${BIC_PREFIX}${bic.toUpperCase().slice(0, 8)}`;
}

/** The bank name an identity records, case and spacing folded; null for a BIC or none. */
export function identityBankName(identity: string | null): string | null {
	return identity?.startsWith(NAME_PREFIX) ? identity.slice(NAME_PREFIX.length) : null;
}

/** The `LIKE` pattern of identities that record a bank by name. */
export const NAME_BANK_IDENTITY_PATTERN = `${NAME_PREFIX}%`;

/**
 * The evidence an account keeps when its statements give several, whatever their order: a name (the bank of a
 * bank-specific format or of the owner's layout) over a BIC, and within one kind the value that sorts first.
 */
export function strongerBankIdentity(left: string | null, right: string | null): string | null {
	if (left === null || right === null) return left ?? right;
	const leftIsName = identityBankName(left) !== null;
	if (leftIsName !== (identityBankName(right) !== null)) return leftIsName ? left : right;
	return left <= right ? left : right;
}
