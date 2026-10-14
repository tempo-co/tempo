import {toBankTransactionDirection} from '../bank-transaction-direction';
import {
	extractCardMerchantName,
	extractStructuredCounterpartyName,
	normalizeBankTransactionText,
} from '../bank-transaction-display';

type MerchantKeyTransaction = {
	description: string | null | undefined;
	counterpartyName: string | null | undefined;
	creditDebitIndicator: string | null | undefined;
};

const TRAILING_TERMINAL_NUMBER_PATTERN = /\s+\d{1,5}$/;
// Payment processors collect for many unrelated merchants, so their bare name does not identify a merchant.
// Matching the leading name covers any legal suffix ("PayPal (Europe) S.a r.l. et Cie, S.C.A.", "Klarna Bank AB").
const PAYMENT_PROCESSOR_NAME_PATTERN =
	/^(?:stichting\s+)?(?:paypal|mollie|adyen|stripe|klarna|tikkie|buckaroo|sumup|worldline|ccv|multisafepay|pay\.nl|riverty|afterpay|ginger payments)\b/;

/**
 * Identifies "the same merchant, in the same direction" across a user's transactions, so a category the user chose
 * manually can be reused. Card lines drop wallet prefixes, card details, payment-processor prefixes and terminal
 * numbers; other rows use the counterparty name, then the plain description.
 */
export function getBankTransactionMerchantKey(transaction: MerchantKeyTransaction): string | null {
	const description = normalizeBankTransactionText(transaction.description);
	const name =
		getCardMerchantName(description) ??
		normalizeBankTransactionText(transaction.counterpartyName) ??
		(description ? extractStructuredCounterpartyName(description) : null) ??
		description;
	const normalizedName = name?.toLowerCase();
	if (!normalizedName || PAYMENT_PROCESSOR_NAME_PATTERN.test(normalizedName)) return null;

	const direction = toBankTransactionDirection(transaction.creditDebitIndicator?.trim() ?? null);
	return `${direction}:${normalizedName}`;
}

// Card terminals append their number ("Example Rail 201"); drop it so every terminal of one merchant matches.
function getCardMerchantName(description: string | null): string | null {
	const name = description ? extractCardMerchantName(description) : null;
	return name ? normalizeBankTransactionText(name.replace(TRAILING_TERMINAL_NUMBER_PATTERN, '')) : null;
}
