import {getBankTransactionDisplayDescription} from './bank-transaction-display';
import {getBankTransactionMerchantKey} from './categorization/bank-transaction-merchant-key';

type BankTransactionText = {
	description?: string | null;
	counterpartyName?: string | null;
	creditDebitIndicator?: string | null;
};

/** The stored columns derived from a transaction's text. Sync and seed data both write them through this. */
export function deriveBankTransactionTextColumns(transaction: BankTransactionText): {
	displayDescription: string;
	merchantKey: string | null;
} {
	return {
		displayDescription: getBankTransactionDisplayDescription(transaction),
		merchantKey: getBankTransactionMerchantKey(transaction),
	};
}
