import {z} from 'zod';
import validator from 'validator';
import {CATEGORY_VALUES} from './categories.generated.js';

export const filtersSchema = z.strictObject({
	bookingDate: z.strictObject({from: z.iso.date().optional(), to: z.iso.date().optional()}).optional(),
	bankAccountIds: z.array(z.uuidv4()).optional(),
	search: z
		.string()
		.refine((value) => validator.isLength(value, {max: 1000}), 'Search must contain at most 1000 characters.')
		.describe(
			'At most 1000 characters, counted like the API MaxLength validator (surrogate pairs and presentation sequences count as one).',
		)
		.optional(),
	categories: z.array(z.enum(CATEGORY_VALUES)).optional(),
	categorySources: z.array(z.enum(['AI', 'HISTORY', 'MANUAL'])).optional(),
	financialEventTypes: z.array(z.enum(['CURRENCY_EXCHANGE', 'OWN_TRANSFER'])).optional(),
	cashFlows: z
		.array(z.enum(['SPENDING', 'INCOME', 'INTERNAL', 'CURRENCY_EXCHANGE', 'OWN_TRANSFER', 'UNKNOWN']))
		.optional(),
	baseAmount: z.enum(['PRESENT', 'MISSING']).optional(),
	categoryStatuses: z.array(z.enum(['FAILED', 'CATEGORIZING'])).optional(),
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
