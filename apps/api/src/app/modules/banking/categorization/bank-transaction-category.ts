import type {BankTransactionCategoryDefinition} from './bank-transaction-categorization.types';

export const BANK_TRANSACTION_CATEGORY_DEFINITIONS: readonly BankTransactionCategoryDefinition[] = [
	{
		value: 'HOUSING_AND_UTILITIES',
		label: 'Housing and utilities',
		description:
			'Household rent, mortgage, energy, water, internet, and phone bills, including recurring bills; repairs, furnishings, and one-off household purchases belong elsewhere.',
	},
	{
		value: 'FOOD_AND_DRINK',
		label: 'Food and drink',
		description:
			'Food and beverages for consumption, including groceries, typical convenience-store purchases, restaurants, cafes, takeaways, workplace coffee and tea, drinks, snacks, and vending purchases; equipment, installation, servicing, fuel, and other non-food purchases are excluded.',
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
			'Goods bought from general retailers, including clothing, electronics, household items, and online orders; food, bills, and clearly specialized services belong elsewhere.',
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
			'Hair, beauty, grooming, cosmetics, and similar personal-care services or products; medical treatment belongs in Health.',
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
			'Charges for banking, payments, commissions, account services, or late and transaction fees; the underlying purchase belongs to its own category.',
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
			'Money received as salary, wages, interest, benefits, or other earned income; refunds, reimbursements, and transfers have separate categories.',
	},
	{
		value: 'REFUND',
		label: 'Refund',
		description:
			'Money returned for an earlier purchase or expense, including reversals and reimbursements; ordinary income and transfers do not qualify.',
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
		description: 'Money moved out to another account or person without being payment for goods, services, or fees.',
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
