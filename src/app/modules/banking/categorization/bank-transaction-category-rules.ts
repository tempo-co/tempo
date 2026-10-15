import type {BankTransaction} from '../bank-transaction.entity';
import type {BankTransactionCategory} from './bank-transaction-category';

export const BANK_TRANSACTION_CATEGORY_RULE_PROVIDER = 'rule';
export const BANK_TRANSACTION_CATEGORY_RULE_VERSION = 'bank-transaction-category-rules-v1';

// OVpay public-transport card taps: a card line whose merchant is only a tap identifier and whose location is the
// OVpay site, for example "BEA, Betaalpas NLOV<id>,PAS123 NR:EX0001, 01.01.26/08:00 www.ovpay.nl".
const OVPAY_CARD_TAP_PATTERN = /^\s*(?:bea|gea),.*,\s*\d{2}[./]\d{2}[./]\d{2}\/\d{2}:\d{2}\s+(?:www\.)?ovpay\.nl\s*$/i;

/**
 * Returns the category a fixed rule assigns without a model call, or null. Rules only cover rows whose category is
 * certain from the bank text alone; everything else goes to the owner's history or the model.
 */
export function getRuleCategory(
	transaction: Pick<BankTransaction, 'description' | 'creditDebitIndicator'>,
): BankTransactionCategory | null {
	const isExpense = transaction.creditDebitIndicator?.toUpperCase() === 'DBIT';
	if (isExpense && transaction.description && OVPAY_CARD_TAP_PATTERN.test(transaction.description)) {
		return 'TRANSPORTATION';
	}
	return null;
}
