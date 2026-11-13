import {createHash} from 'node:crypto';

import {toBankTransactionDirection} from '../bank-transaction-direction';
import {extractProcessorCollectedBusinessName, getBankTransactionDisplayDescription} from '../bank-transaction-display';
import {formatBankTransactionLocation, normalizeBankTransactionLocation} from '../bank-transaction-location';
import {normalizeBankTransactionType} from '../bank-transaction-type';
import {BankTransaction} from '../bank-transaction.entity';
import {truncate} from '../banking.utils';
import {
	BankTransactionCategorizationInput,
	CATEGORIZATION_HASHED_FIELDS,
	MAX_HISTORY_NOTE_LENGTH,
} from './bank-transaction-categorization-input.schema';
import {BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH} from './bank-transaction-categorization.constants';

const MAX_REMITTANCE_INFORMATION_LENGTH = 2_000;
const MAX_WEB_SEARCH_MERCHANT_NAME_LENGTH = 160;
const EMAIL_PATTERN = /\b[\w.+-]+@[\w.-]+\.[A-Z]{2,}\b/gi;
const URL_PATTERN = /\b(?:https?|ftp):\/\/[^\s]+|\bwww\.[^\s]+/gi;
const DOMAIN_PATTERN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?\b/gi;
const DOMAIN_WITH_PATH_PATTERN = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/?#][^\s]*)?/gi;
const IBAN_PATTERN =
	/\b[A-Z]{2}[\s_-]?\d{2}(?:[\s_-]?[A-Z0-9]{4}){2,7}(?:[\s_-]?(?=[A-Z0-9]{1,3}\b)(?=[A-Z0-9]{0,2}\d)[A-Z0-9]{1,3})?\b/gi;
const LABELED_MIXED_ALPHANUMERIC_IDENTIFIER_PATTERN =
	/(\b(?:iban|account|acct|rekening|reference|ref|order|invoice|mandate|identifier|id|pas|nr)\b(?:\s+(?:no\.?|number|num|nr\.?))?\s*[:#=_-]?\s*)(?=[A-Z0-9]*[A-Z])[A-Z0-9]+[\s/.]+\d[A-Z0-9]*(?:[\s/.]+\d[A-Z0-9]*)*/gi;
const LABELED_NUMERIC_MIXED_IDENTIFIER_PATTERN =
	/(\b(?:iban|account|acct|rekening|reference|ref|order|invoice|mandate|identifier|id|pas|nr)\b(?:\s+(?:no\.?|number|num|nr\.?))?\s*[:#=_-]?\s*)\d[A-Z0-9]*(?:\s+(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]+|[./-](?!iban\b|account\b|acct\b|rekening\b|reference\b|ref\b|order\b|invoice\b|mandate\b|identifier\b|id\b|pas\b|nr\b)(?=[A-Z0-9]*[A-Z])[A-Z0-9]+(?:-(?!iban\b|account\b|acct\b|rekening\b|reference\b|ref\b|order\b|invoice\b|mandate\b|identifier\b|id\b|pas\b|nr\b)[A-Z0-9]+)*)(?:[\s/.-]+\d[A-Z0-9]*)*/gi;
const LABELED_GROUPED_NUMERIC_IDENTIFIER_PATTERN =
	/(\b(?:account|acct|rekening|reference|ref|order|invoice|mandate|identifier|id|pas|nr)\b(?:\s+(?:no\.?|number|num|nr\.?))?\s*[:#=_-]?\s*)\d{2,}(?:[\s/.-]+\d{1,})+\b/gi;
const LABELED_IDENTIFIER_PATTERN =
	/(\b(?:iban|account|acct|rekening|reference|ref|order|invoice|mandate|identifier|id|pas|nr)\b(?:\s+(?:no\.?|number|num|nr\.?))?\s*[:#=_-]?\s*)(?=[A-Z0-9_-]*\d)[A-Z0-9_-]+\b/gi;
const LABELED_BIC_PATTERN = /(\b(?:bic|swift)\b\s*[:#=_-]?\s*)[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gi;
const LABELED_PHONE_IDENTIFIER_PATTERN = /\b(?:phone|telephone|mobile|tel|fax)\s*[:#=_-]?\s*\+?\d[\d\s()./-]{5,}\d/gi;
const INTERNATIONAL_PHONE_IDENTIFIER_PATTERN = /(?<![A-Z0-9])\+\d(?:[\d\s()./-]*\d){7,14}(?![A-Z0-9])/g;
const LOCAL_PHONE_IDENTIFIER_PATTERN = /(?<![A-Z0-9])0(?:[\s()-]?\d){8,12}(?![A-Z0-9])/g;
const FORMATTED_CARD_IDENTIFIER_PATTERN =
	/(?<![A-Z0-9])(?:\d{4}(?:[\s-]?\d{4}){2,3}|\d{4}[\s-]\d{6}[\s-]\d{5})(?![A-Z0-9])/g;
const FORMATTED_NUMERIC_IDENTIFIER_PATTERN = /(?<![A-Z0-9])\+?\d[\d\s()./-]{5,}\d(?![A-Z0-9])/gi;
const UNLABELED_ALPHANUMERIC_IDENTIFIER_PATTERN =
	/\b(?=[A-Z0-9_-]*[A-Z])(?=[A-Z0-9_-]*\d[A-Z0-9_-]*\d[A-Z0-9_-]*\d)[A-Z0-9_-]+\b/gi;
const OPAQUE_IDENTIFIER_PATTERN =
	/\b(?=[A-Z0-9_-]{12,}\b)(?=[A-Z0-9_-]*[A-Z])(?=[A-Z0-9_-]*\d[A-Z0-9_-]*\d[A-Z0-9_-]*\d)[A-Z0-9_-]+\b/gi;
// Banks sometimes glue a merchant word to a reference ("ExampleREF0012345"); keep that word, redact the rest.
// Four or more letters, so a short letter run at the start of a random ID ("Abc123DEF456") stays redacted.
const GLUED_LEADING_WORD_PATTERN = /^([A-Z][a-z]{3,})(?=[A-Z0-9_-]+$)/;
const LONG_DIGIT_PATTERN = /\b\d{4,}\b/g;
// A whole merchant name that is one long upper-case code with a digit, like an 18-character transit card tap ID.
// 16+ characters keeps one-word names with a short number ("PLAYSTATION5") searchable.
const BARE_IDENTIFIER_PATTERN = /^(?=\S*\d)(?=\S*[A-Z])[A-Z0-9]{16,}$/;
const LONG_NUMERIC_IDENTIFIER_PATTERN = /\b\d{6,}\b/g;
const REDACTED_IDENTIFIER_LABEL_PATTERN =
	/\b(?:iban|bic|swift|account|acct|rekening|reference|ref|order|invoice|mandate|identifier|id|pas|nr|card|phone|telephone|mobile|tel|fax)\b(?:\s+(?:no\.?|number|num|nr\.?))?\s*[:#=_-]?\s*\[REDACTED\]/gi;
const CARD_LOCATION_PATTERN = /,\s*\d{2}[./]\d{2}[./]\d{2}\/\d{2}:\d{2}\s+(.+)$/i;

type BankTransactionCategorizationTransaction = Pick<
	BankTransaction,
	| 'id'
	| 'transactionDate'
	| 'bookingDate'
	| 'valueDate'
	| 'amount'
	| 'currency'
	| 'creditDebitIndicator'
	| 'bankTransactionCode'
	| 'bankTransactionSubCode'
	| 'description'
	| 'counterpartyName'
	| 'bankTransactionDescription'
	| 'merchantCategoryCode'
	| 'remittanceInformation'
> & {
	aspspName?: string | null;
	merchantLocation?: BankTransaction['merchantLocation'];
};

export function toBankTransactionCategorizationInput(
	transaction: BankTransactionCategorizationTransaction,
): BankTransactionCategorizationInput {
	const creditDebitIndicator = normalizeUppercase(transaction.creditDebitIndicator);
	const bankTransactionCode = normalizeUppercase(transaction.bankTransactionCode);
	const bankTransactionSubCode = normalizeUppercase(transaction.bankTransactionSubCode);
	const bankTransactionDescription = sanitizeCategorizationText(transaction.bankTransactionDescription);
	const transactionType = normalizeBankTransactionType({
		code: bankTransactionCode ?? undefined,
		subCode: bankTransactionSubCode ?? undefined,
		aspspName: transaction.aspspName,
	});
	const merchantLocation = normalizeBankTransactionLocation(transaction.merchantLocation);

	return {
		correlationId: transaction.id,
		transactionDate: normalizeNullableText(transaction.transactionDate),
		bookingDate: normalizeNullableText(transaction.bookingDate),
		valueDate: normalizeNullableText(transaction.valueDate),
		amount: normalizeRequiredText(transaction.amount),
		currency: normalizeUppercase(transaction.currency) ?? '',
		creditDebitIndicator,
		direction: toBankTransactionDirection(creditDebitIndicator),
		transactionType,
		bankTransactionCode,
		bankTransactionSubCode,
		description: sanitizeCategorizationText(transaction.description),
		counterpartyName: sanitizeCategorizationText(transaction.counterpartyName),
		bankTransactionDescription,
		merchantCategoryCode: normalizeMerchantCategoryCode(transaction.merchantCategoryCode),
		remittanceInformation: sanitizeCategorizationText(
			transaction.remittanceInformation,
			MAX_REMITTANCE_INFORMATION_LENGTH,
		),
		...(merchantLocation ? {merchantLocation} : {}),
	};
}

/**
 * The web search a transaction allows: its sanitized merchant name and location, and the one query built from them.
 * Null when no merchant text survives sanitizing, such as a card line that names only a tap identifier.
 */
export function toCategorizationSearch(
	input: BankTransactionCategorizationInput,
): {merchantName: string; merchantLocation: string | null; searchQuery: string} | null {
	const merchantDetails = getWebSearchMerchantDetails(input);
	const merchantName = sanitizeWebSearchMerchantName(merchantDetails.merchantName);
	if (!merchantName) return null;
	const merchantLocation = sanitizeWebSearchMerchantName(merchantDetails.merchantLocation);
	const searchTerms = [
		merchantName,
		merchantLocation && !containsSearchTerm(merchantName, merchantLocation) ? merchantLocation : null,
	].filter(Boolean);
	const searchQuery =
		truncate(searchTerms.join(' '), BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH) ?? merchantName;

	return {merchantName, merchantLocation, searchQuery};
}

/**
 * The merchant name for identifying a merchant's brand: the business a payment processor collects for when its direct
 * debit names one, as the merchant key does, else the web-search name. Hostnames are kept, since a statement's
 * "example.com" or "pay.example.com via Processor" names the business by its site. Identifiers stay removed.
 */
export function toMerchantIdentificationName(input: BankTransactionCategorizationInput): string | null {
	return sanitizeWebSearchMerchantName(
		extractProcessorCollectedBusinessName(input) ?? getWebSearchMerchantDetails(input).merchantName,
		{keepHostnames: true},
	);
}

function getWebSearchMerchantDetails(input: BankTransactionCategorizationInput): {
	merchantName: string | null;
	merchantLocation: string | null;
} {
	const counterpartyName = normalizeNullableText(input.counterpartyName);
	const description = normalizeNullableText(input.description);
	const merchantName =
		counterpartyName ??
		(description ? getBankTransactionDisplayDescription({description, counterpartyName: null}) : null) ??
		normalizeNullableText(input.bankTransactionDescription);
	const merchantLocation =
		formatBankTransactionLocation(input.merchantLocation) ??
		description?.match(CARD_LOCATION_PATTERN)?.[1]?.trim() ??
		null;

	return {merchantName, merchantLocation};
}

/**
 * The hash of the fields that can change what a transaction is: the input minus its correlation id, history hints and
 * dates, with the amount reduced to its sign. A pending payment that books, or a card hold that settles at another
 * amount, keeps its hash and so its category.
 */
export function createBankTransactionCategorizationInputHash(
	value: BankTransaction | BankTransactionCategorizationInput,
): string {
	const input = isCategorizationInput(value)
		? value
		: toBankTransactionCategorizationInput({
				...value,
				aspspName: value.bankAccount?.bankConnection?.aspspName,
			});
	const hashInput: Record<string, unknown> = {};
	for (const field of CATEGORIZATION_HASHED_FIELDS) {
		const fieldValue = field === 'amount' ? amountSign(input.amount) : input[field];
		// An absent location is left out rather than hashed as null.
		if (field === 'merchantLocation' && !fieldValue) continue;
		hashInput[field] = fieldValue;
	}

	return createHash('sha256').update(JSON.stringify(hashInput)).digest('hex');
}

/** The sanitized note of an earlier payment, so the model can see whether it stated its purpose. */
export function toHistoryNote(transaction: {
	remittanceInformation: string | null;
	description: string | null;
}): string | null {
	const remittance = sanitizeCategorizationText(transaction.remittanceInformation);
	const description = sanitizeCategorizationText(transaction.description);
	const parts =
		remittance && description?.length && remittance.includes(description)
			? [remittance]
			: [remittance, description];
	const text = parts.filter(Boolean).join(' | ');
	return text ? truncate(text, MAX_HISTORY_NOTE_LENGTH) : null;
}

function isCategorizationInput(
	value: BankTransaction | BankTransactionCategorizationInput,
): value is BankTransactionCategorizationInput {
	return 'direction' in value;
}

function sanitizeCategorizationText(value: string | null | undefined, maxLength?: number): string | null {
	const normalized = normalizeNullableText(value);
	if (!normalized) return null;

	const sanitized = normalized
		.replace(EMAIL_PATTERN, '[REDACTED]')
		.replace(URL_PATTERN, sanitizeUrlToHostname)
		.replace(DOMAIN_WITH_PATH_PATTERN, '$1')
		.replace(IBAN_PATTERN, '[REDACTED]')
		.replace(LABELED_MIXED_ALPHANUMERIC_IDENTIFIER_PATTERN, '$1[REDACTED]')
		.replace(LABELED_NUMERIC_MIXED_IDENTIFIER_PATTERN, '$1[REDACTED]')
		.replace(LABELED_BIC_PATTERN, '$1[REDACTED]')
		.replace(LABELED_GROUPED_NUMERIC_IDENTIFIER_PATTERN, '$1[REDACTED]')
		.replace(LABELED_IDENTIFIER_PATTERN, '$1[REDACTED]')
		.replace(LABELED_PHONE_IDENTIFIER_PATTERN, '[REDACTED]')
		.replace(INTERNATIONAL_PHONE_IDENTIFIER_PATTERN, '[REDACTED]')
		.replace(LOCAL_PHONE_IDENTIFIER_PATTERN, '[REDACTED]')
		.replace(FORMATTED_CARD_IDENTIFIER_PATTERN, '[REDACTED]')
		.replace(OPAQUE_IDENTIFIER_PATTERN, redactOpaqueIdentifier)
		.replace(LONG_NUMERIC_IDENTIFIER_PATTERN, '[REDACTED]');

	return maxLength === undefined ? sanitized : truncate(sanitized, maxLength);
}

function redactOpaqueIdentifier(identifier: string): string {
	const word = identifier.match(GLUED_LEADING_WORD_PATTERN)?.[1];
	return word ? `${word} [REDACTED]` : '[REDACTED]';
}

function sanitizeUrlToHostname(value: string): string {
	const candidate = value.replace(/[),.;!?]+$/, '');
	try {
		const url = new URL(/^www\./i.test(candidate) ? `https://${candidate}` : candidate);
		return url.hostname
			.toLowerCase()
			.replace(/^www\./, '')
			.replace(/\.$/, '');
	} catch {
		return '[REDACTED]';
	}
}

function sanitizeWebSearchMerchantName(
	value: string | null | undefined,
	{keepHostnames = false}: {keepHostnames?: boolean} = {},
): string | null {
	const normalized = normalizeNullableText(value);
	if (!normalized || BARE_IDENTIFIER_PATTERN.test(normalized)) return null;

	const paymentDomainMerchantName = normalized.match(
		/^(?:https?:\/\/)?(?:www\.)?(?:payment|pay|checkout)\.([a-z][a-z-]*(?:\.[a-z][a-z-]*)*)$/i,
	)?.[1];
	if (paymentDomainMerchantName) return truncate(paymentDomainMerchantName, MAX_WEB_SEARCH_MERCHANT_NAME_LENGTH);

	const withoutAddresses = keepHostnames
		? normalized
				.replace(URL_PATTERN, sanitizeUrlToHostname)
				.replace(EMAIL_PATTERN, ' ')
				.replace(DOMAIN_PATTERN, (domain) => domain.replace(/\/.*$/, ''))
		: normalized.replace(URL_PATTERN, ' ').replace(EMAIL_PATTERN, ' ').replace(DOMAIN_PATTERN, ' ');
	const sanitized = withoutAddresses
		.replace(IBAN_PATTERN, ' ')
		.replace(LABELED_MIXED_ALPHANUMERIC_IDENTIFIER_PATTERN, ' ')
		.replace(LABELED_NUMERIC_MIXED_IDENTIFIER_PATTERN, ' ')
		.replace(LABELED_GROUPED_NUMERIC_IDENTIFIER_PATTERN, ' ')
		.replace(LABELED_IDENTIFIER_PATTERN, ' ')
		.replace(REDACTED_IDENTIFIER_LABEL_PATTERN, ' ')
		.replace(/\[REDACTED\]/gi, ' ')
		.replace(FORMATTED_NUMERIC_IDENTIFIER_PATTERN, ' ')
		.replace(UNLABELED_ALPHANUMERIC_IDENTIFIER_PATTERN, ' ')
		.replace(LONG_DIGIT_PATTERN, ' ')
		.replace(/(?:^|\s)\.{1,}(?=\s|$)/g, ' ')
		.replace(/[,:;|]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	return sanitized.length > 0 ? truncate(sanitized, MAX_WEB_SEARCH_MERCHANT_NAME_LENGTH) : null;
}

function containsSearchTerm(value: string, term: string): boolean {
	const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
	return new RegExp(`(?:^|\\s)${escapedTerm}(?:$|\\s)`, 'i').test(value);
}

function normalizeNullableText(value: string | null | undefined): string | null {
	const normalized = value?.trim() ?? '';
	return normalized.length > 0 ? normalized : null;
}

function normalizeRequiredText(value: string | null | undefined): string {
	return value?.trim() ?? '';
}

function normalizeUppercase(value: string | null | undefined): string | null {
	const normalized = normalizeNullableText(value);
	return normalized?.toUpperCase() ?? null;
}

function normalizeMerchantCategoryCode(value: string | null | undefined): string | null {
	const normalized = normalizeNullableText(value);
	return normalized !== null && /^\d{4}$/.test(normalized) ? normalized : null;
}

/** "-", "0" or "+"; an amount that is not a plain decimal is hashed as it is. */
function amountSign(value: string): string {
	const normalized = normalizeRequiredText(value);
	const match = normalized.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
	if (!match) return normalized;
	const [, sign, integerPart, fractionPart = ''] = match;
	if (/^0*$/.test(integerPart) && /^0*$/.test(fractionPart)) return '0';
	return sign === '-' ? '-' : '+';
}
