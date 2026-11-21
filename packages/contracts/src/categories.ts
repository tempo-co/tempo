export const BANK_TRANSACTION_CATEGORIES = [
	'HOUSING_AND_UTILITIES',
	'HOME_IMPROVEMENT',
	'GROCERIES',
	'EATING_OUT',
	'TRANSPORTATION',
	'SHOPPING',
	'HEALTH',
	'PERSONAL_CARE',
	'ENTERTAINMENT',
	'TRAVEL',
	'SERVICES',
	'EDUCATION',
	'INSURANCE',
	'LOANS_AND_DEBT',
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
			'Rent, mortgage payments, energy, water, internet, and phone bills for the home, including recurring bills; furniture, repairs, and maintenance belong in Home improvement, home insurance in Insurance, and municipal taxes in Taxes and government.',
	},
	{
		value: 'HOME_IMPROVEMENT',
		label: 'Home improvement',
		description:
			'Furniture, hardware, DIY and building supplies, garden supplies, and repairs and maintenance of the home, including tradespeople such as plumbers, electricians, and locksmiths; rent, mortgage, and utility bills belong in Housing and utilities, small household items from a general retailer in Shopping, and household cleaning in Services.',
	},
	{
		value: 'GROCERIES',
		label: 'Groceries',
		description:
			'Food and beverages bought to prepare or consume at home: supermarkets, grocery and food shops, bakeries, butchers, markets, typical convenience-store purchases, and dietary supplements such as protein or vitamins; restaurants, cafes, takeaways, and food delivery orders belong in Eating out, and fuel, household equipment, and other non-food purchases belong elsewhere.',
	},
	{
		value: 'EATING_OUT',
		label: 'Eating out',
		description:
			'Food and beverages bought ready to consume: restaurants, cafes, bars, takeaways, fast food, food delivery orders, workplace coffee and tea, and vending purchases; food bought to prepare at home and food from supermarkets and convenience stores belong in Groceries, and a separate parcel or courier delivery fee in Services.',
	},
	{
		value: 'TRANSPORTATION',
		label: 'Transportation',
		description:
			'Getting around: fuel and vehicle charging, public transport fares and transit passes, parking, tolls, taxis, cycling and scooter hire, vehicle and bike leases, and vehicle purchases. Require evidence of an actual transportation purchase; incidental logistics, delivery, servicing, or transport activities of a merchant do not qualify. Flights and trips away belong in Travel, vehicle insurance in Insurance, and car-loan repayments in Loans and debt.',
	},
	{
		value: 'SHOPPING',
		label: 'Shopping',
		description:
			'Goods bought from general retailers, including clothing, electronics, household items, drugstore items, pet supplies, online orders, items bought as a gift, and shopping memberships such as delivery or marketplace subscriptions; software and apps belong in Services, furniture and hardware in Home improvement, food and drink in Groceries or Eating out, and repairs, cleaning, postage, bills, and other services elsewhere.',
	},
	{
		value: 'HEALTH',
		label: 'Health and fitness',
		description:
			'Medical, dental, vision, pharmacy, therapy, and other healthcare services or treatment, vet bills, and fitness memberships and sessions: gyms, sports clubs, and fitness classes; ordinary personal care belongs in Personal care, sports equipment and general retail purchases in Shopping, tickets to watch sporting events in Entertainment, and insurance premiums in Insurance.',
	},
	{
		value: 'PERSONAL_CARE',
		label: 'Personal care',
		description:
			'Hair, beauty, grooming, cosmetics, toiletries, and similar personal-care services or products, including drugstore purchases of them; medical treatment belongs in Health and fitness.',
	},
	{
		value: 'ENTERTAINMENT',
		label: 'Entertainment',
		description:
			'Leisure and recreation such as cinema, concerts, games, hobbies, books, and sporting events, and streaming and media services for video, music, audiobooks, news, or games; gyms and sports clubs belong in Health and fitness, courses in Education, and software and online tools in Services.',
	},
	{
		value: 'TRAVEL',
		label: 'Travel',
		description:
			'Flights, accommodation, travel agencies, and holiday or trip expenses; everyday local transport belongs in Transportation.',
	},
	{
		value: 'SERVICES',
		label: 'Services',
		description:
			'Paid practical and digital services and small service charges: repairs of shoes, phones, bikes, or clothing, alterations, cleaning, laundry and dry cleaning, postage, parcel and delivery fees, childcare, and software, apps, cloud storage, and online tools; streaming and media services belong in Entertainment, home repairs and tradespeople in Home improvement, food delivery orders in Eating out, bank fees in Fees, personal grooming in Personal care, and utilities in Housing and utilities.',
	},
	{
		value: 'EDUCATION',
		label: 'Education',
		description:
			'Schools, tuition, courses, training, and educational materials; general books and recreational activities need evidence of an educational purpose, and childcare belongs in Services.',
	},
	{
		value: 'INSURANCE',
		label: 'Insurance',
		description:
			'Premiums or payments for an insurance policy, such as health, home, vehicle, travel, or liability insurance; a claim payout, repair, or ordinary service charge is not insurance.',
	},
	{
		value: 'LOANS_AND_DEBT',
		label: 'Loans and debt',
		description:
			'Repayments of debt: personal, car, and student loans, buy-now-pay-later instalments, and credit-card bills paid to a card whose account is not connected; a mortgage belongs in Housing and utilities, a payment to a person is a loan repayment only when its text or earlier picks the owner made for that person say so, and money moved to savings or investments is Transfer out.',
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
			'Money moved out to another account or person that is not a payment for goods, services, fees, or debt, and not a gift, including money moved to savings or investments; loan, buy-now-pay-later, and credit-card repayments belong in Loans and debt.',
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
