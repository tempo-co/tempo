import {ManualCategoryCounts, planManualCategoryFollowUp} from './manual-category-follow-up';

const counts = (entries: [string, number][]) => new Map(entries) as ManualCategoryCounts;

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
