import {
	BANK_TRANSACTION_CATEGORIES,
	BANK_TRANSACTION_CATEGORIZATION_SOURCES,
	BANK_TRANSACTION_CATEGORIZATION_STATUSES,
	BANK_TRANSACTION_CATEGORY_DEFINITIONS,
} from '@tempo/contracts';

describe('bank transaction categorization contract', () => {
	it('defines the stable category values and complete definitions', () => {
		expect(BANK_TRANSACTION_CATEGORIES).toEqual([
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
		]);
		expect(BANK_TRANSACTION_CATEGORY_DEFINITIONS).toHaveLength(23);
		expect(BANK_TRANSACTION_CATEGORY_DEFINITIONS).toEqual(
			expect.arrayContaining(
				BANK_TRANSACTION_CATEGORIES.map((value) =>
					expect.objectContaining({value, label: expect.any(String), description: expect.any(String)}),
				),
			),
		);
		for (const definition of BANK_TRANSACTION_CATEGORY_DEFINITIONS) {
			expect(definition.label.trim()).not.toBe('');
			expect(definition.description.trim()).not.toBe('');
		}
	});

	it('defines only the supported categorization statuses and sources', () => {
		expect(BANK_TRANSACTION_CATEGORIZATION_STATUSES).toEqual([
			'PENDING',
			'PROCESSING',
			'COMPLETED',
			'FAILED',
			'NOT_APPLICABLE',
		]);
		expect(BANK_TRANSACTION_CATEGORIZATION_SOURCES).toEqual(['AI', 'HISTORY', 'MANUAL']);
	});

	it('states the scope of each category that borders another', () => {
		const description = (category: string) =>
			BANK_TRANSACTION_CATEGORY_DEFINITIONS.find(({value}) => value === category)?.description;

		expect(description('GROCERIES')).toContain('typical convenience-store purchases');
		expect(description('GROCERIES')).toContain('food delivery orders belong in Eating out');
		expect(description('EATING_OUT')).toContain(
			'food bought to prepare at home and food from supermarkets and convenience stores belong in Groceries',
		);
		expect(description('HOUSING_AND_UTILITIES')).toContain(
			'furniture, repairs, and maintenance belong in Home improvement',
		);
		expect(description('HOME_IMPROVEMENT')).toContain(
			'rent, mortgage, and utility bills belong in Housing and utilities',
		);
		expect(description('TRANSPORTATION')).toContain('vehicle and bike leases');
		expect(description('HEALTH')).toContain('gyms, sports clubs, and fitness classes');
		expect(description('ENTERTAINMENT')).toContain('streaming and media services');
		expect(description('SERVICES')).toContain('postage, parcel and delivery fees');
		expect(description('SERVICES')).toContain('software, apps, cloud storage, and online tools');
		expect(description('SERVICES')).toContain('streaming and media services belong in Entertainment');
		expect(description('SHOPPING')).toContain('toiletries and cosmetics belong in Personal care');
		expect(description('SHOPPING')).toContain('books, musical instruments, sports and hobby equipment');
		expect(description('SHOPPING')).toContain('tobacco and vaping products');
		expect(description('PERSONAL_CARE')).toContain('including those bought at a drugstore');
		expect(description('PERSONAL_CARE')).toContain('laundry and dry cleaning');
		expect(description('SERVICES')).toContain('laundry, and dry cleaning in Personal care');
		expect(description('TRANSPORTATION')).toContain(
			'vehicle and bike servicing, repairs, inspections, and car washes',
		);
		expect(description('SERVICES')).toContain('vehicle and bike servicing in Transportation');
		expect(description('SERVICES')).toContain('legal, accounting, and advice services');
		expect(description('ENTERTAINMENT')).toContain('gambling and lotteries');
		expect(description('ENTERTAINMENT')).toContain(
			'books, instruments, and other hobby or sports equipment belong in Shopping',
		);
		expect(description('TRAVEL')).toContain(
			'meals, shopping, and other purchases while away keep their own category',
		);
		expect(description('HOUSING_AND_UTILITIES')).toContain('mobile and home phone plans');
		expect(description('INCOME')).toContain('money from selling goods or services');
		expect(description('SHOPPING')).toContain('shopping memberships such as delivery or marketplace subscriptions');
		expect(description('LOANS_AND_DEBT')).toContain('buy-now-pay-later');
		expect(description('LOANS_AND_DEBT')).toContain('a mortgage belongs in Housing and utilities');
		expect(description('LOANS_AND_DEBT')).toContain(
			'a payment to a person is a loan repayment only when its text or earlier picks the owner made for that person say so',
		);
		expect(description('TRANSFER_OUT')).toContain('credit-card repayments belong in Loans and debt');
		expect(description('SHOPPING')).toContain('repairs, cleaning, postage');
		expect(description('TAXES_AND_GOVERNMENT')).toContain('fines, passport, ID, permit, and registration fees');
		expect(description('GIFTS_AND_DONATIONS')).toContain('an item bought in a shop as a gift is Shopping');
		expect(description('TAXES_AND_GOVERNMENT')).toContain('money received from a government is Income or Refund');
		expect(description('INCOME')).toContain('money received from a government, such as income tax refunds');
		expect(description('INCOME')).toContain('unless it pays back a payment the owner made from their account');
		expect(description('REFUND')).toContain('pays back a payment the owner made from their account');
		expect(description('REFUND')).toContain('and is otherwise Income');
	});
});
