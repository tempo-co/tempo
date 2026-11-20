import type {BankImportClosingBalance} from './bank-import.entity';
import type {StatementBalance} from './parsers/parse-result';

/** One statement group of a drop and the account it went to. */
export type GroupAccount = {
	bankAccountId: string;
	created: boolean;
	/** An imported-files account, which takes its balance from its files. */
	fromFiles: boolean;
	closingBalance: StatementBalance | null;
};

/**
 * The accounts an import records, once each, in the order the drop first reached them. Two groups of one drop can
 * reach one account (a statement found by its IBAN and one the owner routed there); the account then keeps the
 * newest closing balance either states, the first group's on a tie.
 */
export function recordedAccounts(groups: readonly GroupAccount[]): {
	bankAccountIds: string[];
	createdBankAccountIds: string[];
	closingBalances: BankImportClosingBalance[];
} {
	const closing = new Map<string, StatementBalance>();
	for (const {bankAccountId, fromFiles, closingBalance} of groups) {
		if (!fromFiles || !closingBalance) continue;
		const newest = closing.get(bankAccountId);
		if (!newest || closingBalance.date > newest.date) closing.set(bankAccountId, closingBalance);
	}
	return {
		bankAccountIds: [...new Set(groups.map(({bankAccountId}) => bankAccountId))],
		createdBankAccountIds: [
			...new Set(groups.filter(({created}) => created).map(({bankAccountId}) => bankAccountId)),
		],
		closingBalances: [...closing].map(([bankAccountId, balance]) => ({bankAccountId, ...balance})),
	};
}
