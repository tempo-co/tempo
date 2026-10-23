import {toBankTransactionDirection} from '../bank-transaction-direction';
import {
	extractCardMerchantName,
	extractStructuredCounterpartyName,
	normalizeBankTransactionText,
} from '../bank-transaction-display';

type MerchantKeyTransaction = {
	description?: string | null;
	counterpartyName?: string | null;
	creditDebitIndicator?: string | null;
};

const TRAILING_TERMINAL_NUMBER_PATTERN = /\s+\d{1,5}$/;
// "Example Shop via Example Pay" or "Example Shop by Example Pay": banks cut the processor tail of a counterparty
// name at varying lengths, so it is dropped to keep every row of one merchant on one key.
const PROCESSOR_SUFFIX_PATTERN = /[\s,;]+(?:via|by)(?:\s.*)?$/i;
const MULTI_WORD_PATTERN = /\S\s+\S/;
// Payment processors collect for many unrelated merchants, so their bare name does not identify a merchant.
// Matching the leading name covers any legal suffix ("PayPal (Europe) S.a r.l. et Cie, S.C.A.", "Klarna Bank AB").
const PAYMENT_PROCESSOR_NAME_PATTERN =
	/^(?:stichting\s+)?(?:paypal|mollie|adyen|stripe|klarna|tikkie|buckaroo|sumup|worldline|ccv|multisafepay|pay\.nl|riverty|afterpay|ginger payments)\b/;
// One business collects under several legal entities ("Example EU S.a r.l.", "Example Payments Europe S.C.A."), so a
// trailing legal form is dropped together with the regional or payment-arm words right before it. A name without a
// legal form keeps every word: "Example Payments" alone may be a different business from "Example".
const LEGAL_FORM_PATTERN =
	/[\s,]+(?:b\.?\s?v\.?|n\.v\.|gmbh|ltd\.?|limited|s\.?\s?(?:a\.?\s?)?r\.?\s?l\.?|s\.?\s?c\.?\s?a\.?|inc\.?|llc|plc)$/i;
// Two-letter forms are also ordinary words or name parts ("Maria Ab"), so they count only in capitals or dotted.
const SHORT_LEGAL_FORM_PATTERN = /[\s,]+(?:NV|AB|AG|SA|SE|A\.B\.|A\.G\.|S\.A\.)$/;
const ENTITY_WORDS = '\\(?(?:eu|europe|benelux|nederland|netherlands|payments)\\)?';
const ENTITY_WORD_PATTERN = new RegExp(`[\\s,]+${ENTITY_WORDS}$`, 'i');
// Banks cut long names mid-word, which can leave one letter of a legal form after an entity word ("Europe S").
const TRUNCATED_LEGAL_FORM_PATTERN = new RegExp(`[\\s,]+${ENTITY_WORDS}\\s+[bglns]\\.?$`, 'i');
const TRAILING_SEPARATOR_PATTERN = /[\s,;]+$/;

/**
 * Identifies "the same merchant, in the same direction" across a user's transactions, so a category the user chose
 * manually can be reused. Card lines drop wallet prefixes, card details, payment-processor prefixes and terminal
 * numbers; other rows use the counterparty name without its payment-processor tail, then the plain description.
 * Card and counterparty names also drop a trailing legal form, so one business's legal entities share a key.
 *
 * The key is stored on each transaction. Changing its output needs a migration that backfills existing rows, or old
 * and new rows from the same merchant stop matching.
 */
export function getBankTransactionMerchantKey(transaction: MerchantKeyTransaction): string | null {
	const description = normalizeBankTransactionText(transaction.description);
	const counterpartyName =
		normalizeBankTransactionText(transaction.counterpartyName) ??
		(description ? extractStructuredCounterpartyName(description) : null);
	const entityName =
		getCardMerchantName(description) ?? (counterpartyName ? stripProcessorTail(counterpartyName) : null);
	const name = entityName ?? description;
	const normalizedName = name?.toLowerCase();
	if (!normalizedName || PAYMENT_PROCESSOR_NAME_PATTERN.test(normalizedName)) return null;
	const key = entityName ? stripLegalEntity(entityName).toLowerCase() : normalizedName;

	const direction = toBankTransactionDirection(transaction.creditDebitIndicator?.trim() ?? null);
	return `${direction}:${key}`;
}

// Keeps the full name when the strip would leave fewer than two words, because "via" or "by" can then be part of the
// name itself ("Example by Night") and a single remaining word would merge unrelated merchants.
function stripProcessorTail(name: string): string {
	const stripped = name.replace(PROCESSOR_SUFFIX_PATTERN, '');
	return MULTI_WORD_PATTERN.test(stripped) ? stripped : name;
}

/** Whether a name ends in a legal form ("Example Music AB"), as the merchant key would strip it. */
export function endsWithLegalForm(name: string): boolean {
	return stripLegalEntity(name) !== name.replace(TRAILING_SEPARATOR_PATTERN, '');
}

// Drops a trailing legal form and then the entity words before it; a name without a legal form is kept whole.
function stripLegalEntity(name: string): string {
	const trimmed = name.replace(TRAILING_SEPARATOR_PATTERN, '');
	if (!trimmed) return name;
	// Banks that write everything in capitals hide whether "SA" is a legal form or a surname ("MARIA SA"), so a
	// two-letter form in an all-caps name counts only when at least two words remain.
	const shortForm = (value: string) => {
		const stripped = value.replace(SHORT_LEGAL_FORM_PATTERN, '');
		return value !== value.toUpperCase() || MULTI_WORD_PATTERN.test(stripped) ? stripped : value;
	};
	let stripped = [
		(value: string) => value.replace(LEGAL_FORM_PATTERN, ''),
		shortForm,
		(value: string) => value.replace(TRUNCATED_LEGAL_FORM_PATTERN, ''),
	].reduce((value, strip) => (value === trimmed ? strip(value) : value), trimmed);
	if (stripped === trimmed || !stripped.trim()) return trimmed;
	for (let next = stripped.replace(ENTITY_WORD_PATTERN, ''); next !== stripped && next.trim();) {
		stripped = next;
		next = stripped.replace(ENTITY_WORD_PATTERN, '');
	}
	return stripped;
}

// Card terminals append their number ("Example Rail 201"); drop it so every terminal of one merchant matches.
function getCardMerchantName(description: string | null): string | null {
	const name = description ? extractCardMerchantName(description) : null;
	return name ? normalizeBankTransactionText(name.replace(TRAILING_TERMINAL_NUMBER_PATTERN, '')) : null;
}
