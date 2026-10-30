export const BANK_TRANSACTION_CATEGORIES = [
	'HOUSING_AND_UTILITIES',
	'FOOD_AND_DRINK',
	'TRANSPORTATION',
	'SHOPPING',
	'SUBSCRIPTIONS',
	'HEALTH',
	'TRAVEL',
	'ENTERTAINMENT',
	'PERSONAL_CARE',
	'EDUCATION',
	'INSURANCE',
	'FEES',
	'CASH_WITHDRAWAL',
	'INCOME',
	'REFUND',
	'TRANSFER_IN',
	'TRANSFER_OUT',
	'NEEDS_REVIEW',
	'OTHER',
] as const;

export type BankTransactionCategory = (typeof BANK_TRANSACTION_CATEGORIES)[number];

export function isBankTransactionCategory(value: string): value is BankTransactionCategory {
	return (BANK_TRANSACTION_CATEGORIES as readonly string[]).includes(value);
}

/** Filters for transactions without a category. */
export const BANK_TRANSACTION_UNCATEGORIZED = 'UNCATEGORIZED' as const;
export const BANK_TRANSACTION_CATEGORY_FILTER_VALUES = [
	...BANK_TRANSACTION_CATEGORIES,
	BANK_TRANSACTION_UNCATEGORIZED,
] as const;
export type BankTransactionCategoryFilterValue = (typeof BANK_TRANSACTION_CATEGORY_FILTER_VALUES)[number];
