/**
 * The bank an account is held at, as `bank_accounts.bankIdentity` records it. A bank's name and its BIC are two kinds
 * of evidence with their own prefix, so they never compare equal.
 */

/**
 * The bank a name names: a connection's institution as the provider names it, the bank a built-in reader or CSV layout
 * belongs to, or the bank an owner named for a saved layout. Compared ignoring case and spacing, so an owner's "ing" is
 * the ING a connection or a built-in layout names.
 */
export function nameBankIdentity(name: string): string {
	return `name:${name.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

/** The bank a statement's BIC names: its first eight characters, the institution without its branch. */
export function bicBankIdentity(bic: string): string {
	return `bic:${bic.toUpperCase().slice(0, 8)}`;
}
