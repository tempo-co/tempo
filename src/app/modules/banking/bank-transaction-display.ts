export function getBankTransactionDisplayDescription({
	description,
	counterpartyName,
}: {
	description?: string | null;
	counterpartyName?: string | null;
}): string {
	const normalizedDescription = normalizeBankTransactionText(description);
	const normalizedCounterpartyName = normalizeBankTransactionText(counterpartyName);

	if (!normalizedDescription) return normalizedCounterpartyName || 'Transaction';

	const collectedBusinessName = extractProcessorCollectedBusinessName({
		description: normalizedDescription,
		counterpartyName: normalizedCounterpartyName,
	});
	if (collectedBusinessName) return collectedBusinessName;

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

// Payment processors collect for unrelated businesses. Keep the catalog shared by display and merchant identity.
const PAYMENT_PROCESSOR_NAME_PATTERN =
	/^(?:stichting\s+)?(?:paypal|mollie|adyen|stripe|klarna|tikkie|buckaroo|sumup|worldline|ccv|multisafepay|pay\.nl|riverty|afterpay|ginger payments)\b/i;

export function isPaymentProcessorName(name: string): boolean {
	return PAYMENT_PROCESSOR_NAME_PATTERN.test(name);
}

// A leading legal business, optionally followed by a locality, before the invoice/reference colon.
const REMITTANCE_NARRATIVE_PREFIX_PATTERN =
	/^(?:invoice|factuur|payment|betaling|reference|kenmerk|order|periode|period)\b/i;
const DIRECT_DEBIT_LEGAL_FORM =
	'(?:b\\.?\\s?v\\.?|n\\.\\s?v\\.|gmbh|ltd\\.?|limited|inc\\.?|llc|plc|s\\.?\\s?(?:a\\.?\\s?)?r\\.?\\s?l\\.?|s\\.\\s?c\\.\\s?a\\.)';
const DIRECT_DEBIT_BUSINESS_PATTERN = new RegExp(
	`^([\\p{L}\\p{M}][\\p{L}\\p{M} &'’().,-]*?\\s+${DIRECT_DEBIT_LEGAL_FORM})(?=(?:\\s+[\\p{L}\\p{M}][\\p{L}\\p{M} .'-]*)?:|$)`,
	'iu',
);

/**
 * A processor's structured SEPA direct-debit remittance can explicitly name the collecting business. Only the
 * leading legal entity is evidence: never search an arbitrary note, nor include the locality or invoice tail.
 * A real counterparty takes precedence over remittance evidence. Source fields are never changed.
 */
export function extractProcessorCollectedBusinessName({
	description,
	counterpartyName,
}: {
	description?: string | null;
	counterpartyName?: string | null;
}): string | null {
	const text = normalizeBankTransactionText(description);
	if (!text || !/^sepa\s+incasso\b/i.test(text)) return null;
	const structuredName = extractStructuredCounterpartyName(text);
	if (!structuredName || !isPaymentProcessorName(structuredName)) return null;
	const counterparty = normalizeBankTransactionText(counterpartyName);
	if (counterparty && !isPaymentProcessorName(counterparty)) return null;
	const remittance = text.match(/\bomschrijving:\s*(.*?)(?=\s+(?:kenmerk|machtiging|iban|bic|naam):|$)/i)?.[1];
	if (!remittance || REMITTANCE_NARRATIVE_PREFIX_PATTERN.test(remittance)) return null;
	// More than one legal entity before the reference separator is ambiguous, not a business plus a locality.
	if (
		remittance.split(':', 1)[0].match(new RegExp(`\\s+${DIRECT_DEBIT_LEGAL_FORM}(?=[\\s,]|$)`, 'gi'))?.length !== 1
	) {
		return null;
	}
	const businessName = remittance.match(DIRECT_DEBIT_BUSINESS_PATTERN)?.[1] ?? null;
	return businessName && !isPaymentProcessorName(businessName) ? businessName : null;
}

const CARD_PREFIX_PATTERN = /^(?:bea|gea),\s*(?:(?:google|apple|garmin|fitbit)\s+pay\s+|betaalpas\s+)?/i;
const CARD_DETAILS_PATTERN = /,\s*pas\s*\d+.*$|\s+nr:.*$|,\s*\d{2}[./]\d{2}[./]\d{2}\/.*$/i;
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
