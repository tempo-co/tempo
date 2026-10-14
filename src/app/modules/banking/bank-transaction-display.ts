export function getBankTransactionDisplayDescription({
	description,
	counterpartyName,
}: {
	description: string | null | undefined;
	counterpartyName: string | null | undefined;
}): string {
	const normalizedDescription = normalizeBankTransactionText(description);
	const normalizedCounterpartyName = normalizeBankTransactionText(counterpartyName);

	if (!normalizedDescription) return normalizedCounterpartyName || 'Transaction';

	const structuredCounterpartyName = extractStructuredCounterpartyName(normalizedDescription);
	if (structuredCounterpartyName) return normalizedCounterpartyName || structuredCounterpartyName;

	const cardMerchantName = extractCardMerchantName(normalizedDescription);
	if (cardMerchantName) return cardMerchantName;

	if (normalizedCounterpartyName && normalizedDescription.length > 80) {
		return normalizedCounterpartyName;
	}

	return normalizedDescription;
}

export function normalizeBankTransactionText(value: string | null | undefined): string | null {
	const normalizedValue = value?.replace(/\s+/g, ' ').trim();
	return normalizedValue || null;
}

export function extractStructuredCounterpartyName(description: string): string | null {
	const match = description.match(/^sepa\b.*?\bnaam:\s*(.+?)(?=\s+(?:omschrijving|kenmerk|machtiging|iban|bic):|$)/i);
	return match?.[1]?.trim() || null;
}

const CARD_PREFIX_PATTERN = /^(?:bea|gea),\s*(?:(?:google|apple|garmin|fitbit)\s+pay\s+|betaalpas\s+)?/i;
const CARD_DETAILS_PATTERN = /,\s*pas\d+.*$|\s+nr:.*$|,\s*\d{2}[./]\d{2}[./]\d{2}\/.*$/i;
const PAYMENT_PROCESSOR_PREFIX_PATTERN = /^(?:bck|ccv|sumup|sq|zettle|iz|msp)\s?\*\s*/i;

/**
 * Returns the merchant from an ABN AMRO card line ("BEA, Google Pay BCK*Example Rail 201,PAS123 NR:..., 01.02.26/10:00
 * CITY" -> "Example Rail 201"): drops the wallet prefix, card details, booking time and payment-processor prefix.
 */
export function extractCardMerchantName(description: string): string | null {
	if (!CARD_PREFIX_PATTERN.test(description)) return null;
	return normalizeBankTransactionText(
		description
			.replace(CARD_PREFIX_PATTERN, '')
			.replace(CARD_DETAILS_PATTERN, '')
			.replace(PAYMENT_PROCESSOR_PREFIX_PATTERN, ''),
	);
}
