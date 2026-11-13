import {BANK_TRANSACTION_CATEGORIES} from '@tempo/contracts';
import {z} from 'zod';

import {BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE} from '@core/queue/queue.constants';

import {BANK_TRANSACTION_DIRECTIONS} from '../bank-transaction-direction';
import {BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH} from './bank-transaction-categorization.constants';

/**
 * The one definition of what Tempo sends the model about a transaction. It yields the TypeScript types, the fields the
 * provider serializes, the fields the input hash covers, and the JSON Schema the subscription bridge validates
 * requests against (`input` in `claude-bridge/contract.json`, written by `npm run contract:input`).
 */

/** Longest text the bridge accepts in one field. Lengths count UTF-16 code units, as zod and JavaScript do. */
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
	creditDebitIndicator: nullableText,
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

/** Hints from the owner's history. They are context for the model, never part of the input hash. */
const hintFields = {
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
};

const categorizationInputSchema = z.object({correlationId: text, ...classifiedFields, ...hintFields}).strict();

/** The one web search query a call may run: sanitized merchant text, never identifiers, amounts or dates. */
const searchQuerySchema = nonBlankText.max(BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH);

/** Build it with `toBankTransactionCategorizationInput`, which normalizes the fields the hash and the model see. */
export type BankTransactionCategorizationInput = z.infer<typeof categorizationInputSchema>;
export type PreviousManualCategory = z.infer<typeof previousManualCategorySchema>;
export type SameAmountPayment = z.infer<typeof sameAmountPaymentSchema>;

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

/** The request limits the subscription bridge checks, as stored under `input` in `claude-bridge/contract.json`. */
export function toBridgeInputContract() {
	return {
		input: {
			maxTransactions: BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE,
			transaction: z.toJSONSchema(categorizationInputSchema),
			searchQuery: z.toJSONSchema(searchQuerySchema),
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
	for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
		const fieldValue = record[key];
		const absent =
			fieldValue === undefined || fieldValue === null || (Array.isArray(fieldValue) && fieldValue.length === 0);
		if (field instanceof z.ZodOptional && absent) continue;
		picked[key] = pickFields(field, fieldValue);
	}
	return picked;
}
