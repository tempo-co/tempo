import {toBankTransactionDirection} from '../bank-transaction-direction';
import {extractStructuredCounterpartyName, normalizeBankTransactionText} from '../bank-transaction-display';

type MerchantKeyTransaction = {
	description: string | null | undefined;
	counterpartyName: string | null | undefined;
	creditDebitIndicator: string | null | undefined;
};

const CARD_PREFIX_PATTERN = /^(?:BEA|GEA),\s*(?:(?:Google|Apple|Garmin|Fitbit)\s+Pay\s+|Betaalpas\s+)?/i;
const CARD_DETAILS_PATTERN = /,\s*PAS\d+.*$|\s+NR:.*$|,\s*\d{2}[./]\d{2}[./]\d{2}\/.*$/i;
const PROCESSOR_PREFIX_PATTERN = /^(?:BCK|CCV|SUMUP|SQ|ZETTLE|IZ|MSP)\s?\*\s*/i;
const TRAILING_TERMINAL_NUMBER_PATTERN = /\s+\d{1,5}$/;

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
	const normalizedName = name?.toLowerCase().replace(/\s+/g, ' ').trim();
	if (!normalizedName) return null;

	const direction = toBankTransactionDirection(transaction.creditDebitIndicator?.trim().toUpperCase() ?? null);
	return `${direction}:${normalizedName}`;
}

function getCardMerchantName(description: string | null): string | null {
	if (!description || !CARD_PREFIX_PATTERN.test(description)) return null;
	const name = description
		.replace(CARD_PREFIX_PATTERN, '')
		.replace(CARD_DETAILS_PATTERN, '')
		.replace(PROCESSOR_PREFIX_PATTERN, '')
		.replace(TRAILING_TERMINAL_NUMBER_PATTERN, '')
		.trim();
	return name || null;
}
