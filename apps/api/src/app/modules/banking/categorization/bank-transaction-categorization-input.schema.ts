import {BANK_TRANSACTION_CATEGORIES} from '@wisp/contracts';
import {z} from 'zod';

import {BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE} from '@core/queue/queue.constants';

import {BANK_TRANSACTION_DIRECTIONS, CREDIT_DEBIT_INDICATORS} from '../bank-transaction-direction';
import {BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH} from './bank-transaction-categorization.constants';

/**
 * The one definition of what Wisp sends the model about a transaction. It yields the TypeScript types, the fields the
 * provider serializes, the fields the input hash covers, and the JSON Schema of a request (`input` in
 * `providers/claude-categorization-contract.json`, written by `npm run contract:input`).
 */

/** Longest text of one field. Lengths count UTF-16 code units, as zod and JavaScript do. */
const MAX_FIELD_LENGTH = 8192;
/** Most recent manual choices per category the model sees as examples. */
export const MAX_MANUAL_CATEGORY_EXAMPLES = 5;
/** Longest note of an earlier payment the model sees next to it. */
export const MAX_HISTORY_NOTE_LENGTH = 200;
/** Earlier same-amount payments to one payee are a hint only from this many on. */
export const MIN_SAME_AMOUNT_PAYMENTS = 2;
/** Same-amount payments to one payee the model sees, per source. */
export const MAX_SAME_AMOUNT_MANUAL_PAYMENTS = 5;
export const MAX_SAME_AMOUNT_AI_PAYMENTS = 10;
/** Earlier payments with the same counterparty the model sees, newest first, per direction relative to the row. */
export const MAX_COUNTERPARTY_HISTORY_SAME_DIRECTION = 6;
export const MAX_COUNTERPARTY_HISTORY_OPPOSITE_DIRECTION = 4;
/** How far before a row's own date its counterparty history reaches. */
export const COUNTERPARTY_HISTORY_MONTHS = 24;

const text = z.string().max(MAX_FIELD_LENGTH);
const nullableText = text.nullable();
const nonBlankText = text.regex(/\S/);
const direction = z.enum(BANK_TRANSACTION_DIRECTIONS);
const category = z.enum(BANK_TRANSACTION_CATEGORIES);

const locationSchema = z.object({city: nullableText, region: nullableText, country: nullableText}).strict();

/**
 * The fields of a transaction the model sees, in serialized order. The input hash covers the ones that can change what
 * the transaction is ({@link CATEGORIZATION_HASHED_FIELDS}).
 */
const classifiedFields = {
	transactionDate: nullableText,
	bookingDate: nullableText,
	valueDate: nullableText,
	amount: text,
	currency: text,
	creditDebitIndicator: z.enum(CREDIT_DEBIT_INDICATORS),
	direction,
	transactionType: text,
	bankTransactionCode: nullableText,
	bankTransactionSubCode: nullableText,
	description: nullableText,
	counterpartyName: nullableText,
	bankTransactionDescription: nullableText,
	merchantCategoryCode: nullableText,
	remittanceInformation: nullableText,
	merchantLocation: locationSchema.nullable().optional(),
};

const previousManualCategorySchema = z
	.object({
		category,
		count: z.number().int().positive(),
		recentExamples: z
			.array(z.object({amount: text, currency: text, date: nullableText, text: nullableText}).strict())
			.max(MAX_MANUAL_CATEGORY_EXAMPLES),
	})
	.strict();

const sameAmountPaymentSchema = z
	.object({date: nullableText, category, source: z.enum(['MANUAL', 'AI']), text: nullableText})
	.strict();

const ownerBankSchema = z.object({name: text, country: text}).strict();

const counterpartyHistoryEntrySchema = z
	.object({date: text, amount: text, currency: text, direction, category})
	.strict();

/** Hints from the owner's bank and history. They are context for the model, never part of the input hash. */
const hintFields = {
	/** The bank that holds the owner's account and its country, which tell which local businesses are likely. */
	ownerBank: ownerBankSchema.optional(),
	/**
	 * Every category the owner chose manually for the same merchant, most frequent first, with how often and the
	 * amounts, currencies, dates and notes of their most recent choices. Only a hint for the model; never applied
	 * without it.
	 */
	previousManualCategories: z.array(previousManualCategorySchema).max(BANK_TRANSACTION_CATEGORIES.length).optional(),
	/**
	 * Earlier completed payments to the same payee with exactly this amount and currency: the owner's picks newest
	 * first, then the two oldest AI rows per category. Lets the model reuse a consistent payment's category, such as
	 * monthly rent to a person.
	 */
	sameAmountPayments: z
		.array(sameAmountPaymentSchema)
		.min(MIN_SAME_AMOUNT_PAYMENTS)
		.max(MAX_SAME_AMOUNT_MANUAL_PAYMENTS + MAX_SAME_AMOUNT_AI_PAYMENTS)
		.optional(),
	/**
	 * Earlier categorized payments in either direction with the same counterparty (the same IBAN or merchant name)
	 * within the months before this one, newest first per direction, leaving out those in `sameAmountPayments`.
	 * Reveals recurring bills, refunds and money paid back.
	 */
	counterpartyHistory: z
		.array(counterpartyHistoryEntrySchema)
		.max(MAX_COUNTERPARTY_HISTORY_SAME_DIRECTION + MAX_COUNTERPARTY_HISTORY_OPPOSITE_DIRECTION)
		.optional(),
};

const categorizationInputSchema = z.object({correlationId: text, ...classifiedFields, ...hintFields}).strict();

/** The one web search query a call may run: sanitized merchant text, never identifiers, amounts or dates. */
const searchQuerySchema = nonBlankText.max(BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH);

/** How many web results the categorizing call sees for a merchant, and how long each one's text may be. */
export const MAX_MERCHANT_SEARCH_RESULTS = 5;
export const MAX_MERCHANT_SEARCH_TITLE_LENGTH = 200;
export const MAX_MERCHANT_SEARCH_SNIPPET_LENGTH = 500;

const merchantSearchResultSchema = z
	.object({
		title: nonBlankText.max(MAX_MERCHANT_SEARCH_TITLE_LENGTH).nullable(),
		hostname: nonBlankText,
		snippet: nonBlankText.max(MAX_MERCHANT_SEARCH_SNIPPET_LENGTH),
	})
	.strict();

/**
 * The top web results for a row group's code-built merchant query, sent beside the transactions in a second
 * categorizing call when the first one asked for a lookup.
 */
const merchantSearchSchema = z
	.object({
		query: searchQuerySchema,
		results: z.array(merchantSearchResultSchema).min(1).max(MAX_MERCHANT_SEARCH_RESULTS),
	})
	.strict();

/** Build it with `toBankTransactionCategorizationInput`, which normalizes the fields the hash and the model see. */
export type BankTransactionCategorizationInput = z.infer<typeof categorizationInputSchema>;
export type MerchantSearchResult = z.infer<typeof merchantSearchResultSchema>;
export type MerchantSearch = z.infer<typeof merchantSearchSchema>;
export type PreviousManualCategory = z.infer<typeof previousManualCategorySchema>;
export type SameAmountPayment = z.infer<typeof sameAmountPaymentSchema>;
export type OwnerBank = z.infer<typeof ownerBankSchema>;
export type CounterpartyHistoryEntry = z.infer<typeof counterpartyHistoryEntrySchema>;

type ClassifiedField = keyof typeof classifiedFields;

/**
 * Fields that never change what a transaction is, so they stay out of the input hash: a pending payment that books
 * changes its dates, and a final amount can differ from a card hold. The hash keeps the amount's sign instead.
 */
const UNHASHED_FIELDS: readonly ClassifiedField[] = ['transactionDate', 'bookingDate', 'valueDate'];

/** The fields the input hash covers, in hashed order. `amount` is hashed as its sign only. */
export const CATEGORIZATION_HASHED_FIELDS = (Object.keys(classifiedFields) as ClassifiedField[]).filter(
	(field) => !UNHASHED_FIELDS.includes(field),
);

/**
 * The fields of `input` the model may see, in schema order, nested hints included: anything else is dropped, and so
 * are optional fields that are absent, null or empty.
 */
export function toCategorizationRequestTransaction(
	input: BankTransactionCategorizationInput,
): BankTransactionCategorizationInput {
	return pickFields(categorizationInputSchema, input) as BankTransactionCategorizationInput;
}

/** The request limits, as stored under `input` in `providers/claude-categorization-contract.json`. */
export function toInputContract() {
	return {
		input: {
			maxTransactions: BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE,
			transaction: z.toJSONSchema(categorizationInputSchema),
			searchQuery: z.toJSONSchema(searchQuerySchema),
			merchantSearch: z.toJSONSchema(merchantSearchSchema),
		},
	};
}

function pickFields(schema: z.ZodType, value: unknown): unknown {
	if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable)
		return value === null || value === undefined ? value : pickFields(schema.unwrap() as z.ZodType, value);
	if (schema instanceof z.ZodArray)
		return Array.isArray(value) ? value.map((item) => pickFields(schema.element as z.ZodType, item)) : value;
	if (!(schema instanceof z.ZodObject) || typeof value !== 'object' || value === null) return value;

	const record = value as Record<string, unknown>;
	const picked: Record<string, unknown> = {};
	for (const [key, field] of Object.entries<z.ZodType>(schema.shape)) {
		const fieldValue = record[key];
		const absent =
			fieldValue === undefined || fieldValue === null || (Array.isArray(fieldValue) && fieldValue.length === 0);
		if (field instanceof z.ZodOptional && absent) continue;
		picked[key] = pickFields(field, fieldValue);
	}
	return picked;
}
