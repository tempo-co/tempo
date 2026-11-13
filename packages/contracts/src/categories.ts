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
	'SERVICES',
	'EDUCATION',
	'INSURANCE',
	'FEES',
	'TAXES_AND_GOVERNMENT',
	'GIFTS_AND_DONATIONS',
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

export type BankTransactionCategoryDefinition = {
	value: BankTransactionCategory;
	label: string;
	description: string;
};

export const BANK_TRANSACTION_CATEGORY_DEFINITIONS: readonly BankTransactionCategoryDefinition[] = [
	{
		value: 'HOUSING_AND_UTILITIES',
		label: 'Housing and utilities',
		description:
			'Household rent, mortgage, energy, water, internet, and phone bills, including recurring bills; repairs, furnishings, one-off household purchases, and municipal taxes belong elsewhere.',
	},
	{
		value: 'FOOD_AND_DRINK',
		label: 'Food and drink',
		description:
			'Food and beverages for consumption, including groceries, typical convenience-store purchases, restaurants, cafes, takeaways, workplace coffee and tea, drinks, snacks, vending purchases, and dietary supplements such as protein or vitamins; equipment, installation, servicing, fuel, and other non-food purchases are excluded.',
	},
	{
		value: 'TRANSPORTATION',
		label: 'Transportation',
		description:
			'Require evidence of an actual transportation purchase, such as fuel, public transport, parking, taxis, cycling, or a vehicle purchase; incidental logistics, delivery, servicing, or transport activities of a merchant do not qualify.',
	},
	{
		value: 'SHOPPING',
		label: 'Shopping',
		description:
			'Goods bought from general retailers, including clothing, electronics, household items, drugstore items, online orders, and items bought as a gift; repairs, cleaning, postage, food, bills, and other services belong elsewhere.',
	},
	{
		value: 'SUBSCRIPTIONS',
		label: 'Subscriptions',
		description:
			'Recurring access to software, media, memberships, or other services; ordinary household bills and one-off purchases belong elsewhere.',
	},
	{
		value: 'HEALTH',
		label: 'Health',
		description:
			'Medical, dental, vision, pharmacy, therapy, and other healthcare services or treatment; classify ordinary personal care and general retail purchases elsewhere.',
	},
	{
		value: 'TRAVEL',
		label: 'Travel',
		description:
			'Flights, accommodation, travel agencies, and holiday or trip expenses; everyday local transport belongs in Transportation.',
	},
	{
		value: 'ENTERTAINMENT',
		label: 'Entertainment',
		description:
			'Leisure and recreation such as cinema, concerts, games, hobbies, books, and sporting events; courses and essential services are not entertainment.',
	},
	{
		value: 'PERSONAL_CARE',
		label: 'Personal care',
		description:
			'Hair, beauty, grooming, cosmetics, toiletries, and similar personal-care services or products, including drugstore purchases of them; medical treatment belongs in Health.',
	},
	{
		value: 'SERVICES',
		label: 'Services',
		description:
			'Paid practical services and small service charges, such as repairs of shoes, phones, bikes, or clothing, alterations, cleaning, laundry and dry cleaning, postage, parcel and delivery fees, and locksmiths; food delivery orders, bank fees, subscriptions, personal grooming, and utilities belong to their own categories.',
	},
	{
		value: 'EDUCATION',
		label: 'Education',
		description:
			'Schools, tuition, courses, training, and educational materials; general books, childcare, and recreational activities need evidence of an educational purpose.',
	},
	{
		value: 'INSURANCE',
		label: 'Insurance',
		description:
			'Premiums or payments for an insurance policy; a claim payout, repair, or ordinary service charge is not insurance.',
	},
	{
		value: 'FEES',
		label: 'Fees',
		description:
			'Charges for banking, payments, commissions, account services, or late and transaction fees; the underlying purchase belongs to its own category, and fees paid to a government belong in Taxes and government.',
	},
	{
		value: 'TAXES_AND_GOVERNMENT',
		label: 'Taxes and government',
		description:
			'Payments to a government: municipal and national taxes, fines, passport, ID, permit, and registration fees, and court or government agency fees; insurance, utilities, and public transport fares belong elsewhere, and money received from a government is Income or Refund as those categories describe.',
	},
	{
		value: 'GIFTS_AND_DONATIONS',
		label: 'Gifts and donations',
		description:
			'Charity donations and money given as a gift, including a payment to a person whose text names a gift, birthday, or present; an item bought in a shop as a gift is Shopping.',
	},
	{
		value: 'CASH_WITHDRAWAL',
		label: 'Cash withdrawal',
		description:
			'Money taken as cash from an ATM, bank counter, or cash service; a card purchase at a cash-related merchant is not enough.',
	},
	{
		value: 'INCOME',
		label: 'Income',
		description:
			'Money received as salary, wages, interest, benefits, or other earned income, and money received from a government, such as income tax refunds, allowances, and benefits, unless it pays back a payment the owner made from their account (Refund); refunds of purchases, reimbursements, and transfers have separate categories.',
	},
	{
		value: 'REFUND',
		label: 'Refund',
		description:
			'Money returned for an earlier purchase or expense, including reversals and reimbursements; money from a government counts only when it pays back a payment the owner made from their account, such as an overpaid municipal tax bill or a cancelled fine, and is otherwise Income. Ordinary income and transfers do not qualify.',
	},
	{
		value: 'TRANSFER_IN',
		label: 'Transfer in',
		description:
			'Money moved into an account from another account or person without being payment for goods, services, or earned income.',
	},
	{
		value: 'TRANSFER_OUT',
		label: 'Transfer out',
		description:
			'Money moved out to another account or person that is not a payment for goods, services, or fees, and not a gift.',
	},
	{
		value: 'NEEDS_REVIEW',
		label: 'Needs review',
		description:
			'Use when the transaction is real but the available evidence is insufficient or conflicting and its purpose cannot be determined reliably.',
	},
	{
		value: 'OTHER',
		label: 'Other',
		description: 'Use when evidence supports that the transaction falls outside the other categories.',
	},
];
