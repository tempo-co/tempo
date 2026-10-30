import {
	BANK_TRANSACTION_CATEGORIZATION_SOURCES,
	BANK_TRANSACTION_CATEGORIZATION_STATUSES,
} from './bank-transaction-categorization.types';
import {BANK_TRANSACTION_CATEGORIES, BANK_TRANSACTION_CATEGORY_DEFINITIONS} from './bank-transaction-category';

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
		]);
		expect(BANK_TRANSACTION_CATEGORY_DEFINITIONS).toHaveLength(19);
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

	it('makes grocery and convenience purchases explicit in Food and drink guidance', () => {
		const foodAndDrink = BANK_TRANSACTION_CATEGORY_DEFINITIONS.find(({value}) => value === 'FOOD_AND_DRINK');

		expect(foodAndDrink?.description).toContain('typical convenience-store purchases');
	});
});
