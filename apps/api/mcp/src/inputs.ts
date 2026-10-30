import {z} from 'zod';
import validator from 'validator';
import {
	BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES,
	BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES,
	BANK_TRANSACTION_CATEGORIZATION_SOURCES,
	BANK_TRANSACTION_CATEGORY_FILTER_VALUES,
	BANK_TRANSACTION_CATEGORY_STATUS_FILTER_VALUES,
	BANK_TRANSACTION_FINANCIAL_EVENT_FILTER_VALUES,
	BANK_TRANSACTION_SEARCH_MAX_LENGTH,
	BANK_TRANSACTION_SORT_FIELDS,
	SORT_ORDERS,
	type BankTransactionFilter,
} from '@tempo/contracts';

export const filtersSchema = z.strictObject({
	bookingDate: z.strictObject({from: z.iso.date().optional(), to: z.iso.date().optional()}).optional(),
	bankAccountIds: z.array(z.uuidv4()).optional(),
	search: z
		.string()
		.refine(
			(value) => validator.isLength(value, {max: BANK_TRANSACTION_SEARCH_MAX_LENGTH}),
			`Search must contain at most ${BANK_TRANSACTION_SEARCH_MAX_LENGTH} characters.`,
		)
		.describe(
			`At most ${BANK_TRANSACTION_SEARCH_MAX_LENGTH} characters, counted like the API MaxLength validator (surrogate pairs and presentation sequences count as one).`,
		)
		.optional(),
	categories: z.array(z.enum(BANK_TRANSACTION_CATEGORY_FILTER_VALUES)).optional(),
	categorySources: z.array(z.enum(BANK_TRANSACTION_CATEGORIZATION_SOURCES)).optional(),
	financialEventTypes: z.array(z.enum(BANK_TRANSACTION_FINANCIAL_EVENT_FILTER_VALUES)).optional(),
	cashFlows: z.array(z.enum(BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES)).optional(),
	baseAmount: z.enum(BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES).optional(),
	categoryStatuses: z.array(z.enum(BANK_TRANSACTION_CATEGORY_STATUS_FILTER_VALUES)).optional(),
	recurringSeriesKey: z
		.string()
		.regex(/^[0-9a-f]{32}$/)
		.optional(),
}) satisfies z.ZodType<BankTransactionFilter>;

export const sortSchema = z.strictObject({
	by: z.enum(BANK_TRANSACTION_SORT_FIELDS),
	order: z.enum(SORT_ORDERS),
});

export function filterQuery(filters: z.infer<typeof filtersSchema> = {}): URLSearchParams {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(filters)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) for (const item of value) query.append(`filter[${key}][]`, item);
		else if (typeof value === 'object')
			for (const [field, date] of Object.entries(value)) {
				if (date !== undefined) query.set(`filter[${key}][${field}]`, date);
			}
		else query.set(`filter[${key}]`, value);
	}
	return query;
}
