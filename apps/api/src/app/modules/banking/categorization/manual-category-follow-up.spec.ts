import type {BankTransactionCategory} from '@tempo/contracts';

import {
	ManualCategoryCounts,
	planManualCategoryFollowUp,
	whereManualCategoryFollowUpCandidates,
	withoutOneOffChoices,
} from './manual-category-follow-up';

function recordingQuery() {
	const conditions: string[] = [];
	const parameters: Record<string, unknown> = {};
	const query = {
		where: jest.fn(),
		andWhere: jest.fn(),
	};
	for (const method of [query.where, query.andWhere]) {
		method.mockImplementation((condition: string, values?: Record<string, unknown>) => {
			conditions.push(condition.replace(/\s+/g, ' ').trim());
			Object.assign(parameters, values);
			return query;
		});
	}
	return {query, conditions, parameters};
}

const counts = (entries: [string, number][]) => new Map(entries) as ManualCategoryCounts;

describe('withoutOneOffChoices', () => {
	it.each([
		[
			'drops a single choice when the merchant has rows in another category',
			[['HEALTH', 1]],
			['FOOD_AND_DRINK', 'HEALTH'],
			[],
		],
		[
			'keeps a repeated choice and drops the one-off beside it',
			[
				['FOOD_AND_DRINK', 2],
				['HEALTH', 1],
			],
			['FOOD_AND_DRINK', 'HEALTH'],
			[['FOOD_AND_DRINK', 2]],
		],
		[
			'drops both single choices that disagree',
			[
				['SHOPPING', 1],
				['PERSONAL_CARE', 1],
			],
			['SHOPPING', 'PERSONAL_CARE'],
			[],
		],
		[
			'keeps a single choice when it is all that is known',
			[['ENTERTAINMENT', 1]],
			['ENTERTAINMENT'],
			[['ENTERTAINMENT', 1]],
		],
		['keeps a single choice when no completed row is known', [['TRAVEL', 1]], [], [['TRAVEL', 1]]],
	] as const)('%s', (_name, choices, merchantCategories, expected) => {
		expect([
			...withoutOneOffChoices(
				counts(choices.map(([category, count]) => [category, count])),
				new Set(merchantCategories as readonly BankTransactionCategory[]),
			),
		]).toEqual(expected);
	});
});

describe('planManualCategoryFollowUp', () => {
	it.each([
		['one consistent choice', counts([['SHOPPING', 2]]), true, {action: 'APPLY', category: 'SHOPPING'}],
		['one consistent choice without AI', counts([['SHOPPING', 2]]), false, {action: 'APPLY', category: 'SHOPPING'}],
		[
			'mixed choices',
			counts([
				['SHOPPING', 1],
				['TRAVEL', 1],
			]),
			true,
			{action: 'RECHECK'},
		],
		['no choice left', counts([]), true, {action: 'RECHECK'}],
		['no history', undefined, true, {action: 'RECHECK'}],
		[
			'mixed choices without AI',
			counts([
				['SHOPPING', 1],
				['TRAVEL', 1],
			]),
			false,
			null,
		],
		['no choice left without AI', undefined, false, null],
	])('plans %s', (_, history, recheckEnabled, expected) => {
		expect(planManualCategoryFollowUp(history, recheckEnabled)).toEqual(expected);
	});
});

describe('whereManualCategoryFollowUpCandidates', () => {
	const scope = {accountId: 'account-1', merchantKey: 'EXPENSE:example shop'};

	it("limits rows to the owner's non-manual rows for the merchant that automation may change", () => {
		const {query, conditions, parameters} = recordingQuery();

		whereManualCategoryFollowUpCandidates(query as never, {...scope, followUp: {action: 'RECHECK'}});

		expect(conditions).toEqual([
			'"merchantKey" = :merchantKey',
			expect.stringContaining('WHERE connection."accountId" = :accountId'),
			`"categorySource" IS DISTINCT FROM 'MANUAL'`,
			'"categoryStatus" IN (:...followUpStatuses)',
			'"categoryInputHash" IS NOT NULL',
			'"ownTransferEvidence" IS NULL',
			'"financialEventType" IS NULL',
			`"categorySource" = 'HISTORY'`,
		]);
		expect(parameters).toEqual({
			merchantKey: 'EXPENSE:example shop',
			accountId: 'account-1',
			followUpStatuses: ['PENDING', 'FAILED', 'COMPLETED'],
		});
	});

	it('skips rows that already have the applied history category', () => {
		const {query, conditions, parameters} = recordingQuery();

		whereManualCategoryFollowUpCandidates(query as never, {
			...scope,
			followUp: {action: 'APPLY', category: 'SHOPPING'},
		});

		expect(conditions.at(-1)).toBe(
			`("category" IS DISTINCT FROM :followUpCategory OR "categorySource" IS DISTINCT FROM 'HISTORY')`,
		);
		expect(parameters.followUpCategory).toBe('SHOPPING');
	});

	it('narrows the same rules to the selected ids', () => {
		const {query, conditions, parameters} = recordingQuery();

		whereManualCategoryFollowUpCandidates(query as never, {
			...scope,
			followUp: {action: 'RECHECK'},
			transactionIds: ['selected-1'],
		});

		expect(conditions).toHaveLength(9);
		expect(conditions.at(-1)).toBe('id IN (:...followUpTransactionIds)');
		expect(parameters.followUpTransactionIds).toEqual(['selected-1']);
	});
});
