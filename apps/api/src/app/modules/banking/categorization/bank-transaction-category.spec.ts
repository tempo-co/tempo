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
		]);
		expect(BANK_TRANSACTION_CATEGORY_DEFINITIONS).toHaveLength(22);
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

		expect(description('FOOD_AND_DRINK')).toContain('typical convenience-store purchases');
		expect(description('SERVICES')).toContain('postage, parcel and delivery fees');
		expect(description('SERVICES')).toContain('food delivery orders, bank fees, subscriptions, personal grooming');
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
