import {buildHomePace, buildSpendingPace, usualPaceMonths} from './spending-pace';

const cents = (entries: Record<number, number>) =>
	new Map(Object.entries(entries).map(([day, value]) => [Number(day), BigInt(value)]));

describe('spending pace', () => {
	it('builds a zero-filled cumulative pace through the cut-off day', () => {
		const pace = buildSpendingPace({
			daysInMonth: 31,
			throughDay: 5,
			daily: cents({1: 1000, 3: 250, 4: -300}),
			baseline: [],
		});

		expect(pace.daily).toEqual([
			{day: 1, spending: '10.00', cumulative: '10.00'},
			{day: 2, spending: '0.00', cumulative: '10.00'},
			{day: 3, spending: '2.50', cumulative: '12.50'},
			{day: 4, spending: '-3.00', cumulative: '9.50'},
			{day: 5, spending: '0.00', cumulative: '9.50'},
		]);
		expect(pace.baseline).toEqual([]);
	});

	it('averages baseline months over the whole viewed month, capping shorter months at their last day', () => {
		const pace = buildSpendingPace({
			daysInMonth: 31,
			throughDay: 18,
			daily: cents({}),
			baseline: [
				{days: 28, daily: cents({1: 100, 28: 900})},
				{days: 30, daily: cents({1: 300, 30: 50})},
				{days: 31, daily: cents({2: 200, 31: 1})},
			],
		});

		expect(pace.baseline).toHaveLength(31);
		expect(pace.baseline[0]).toEqual({day: 1, average: '1.33', low: '0.00', high: '3.00'});
		expect(pace.baseline[17]).toEqual({day: 18, average: '2.00', low: '1.00', high: '3.00'});
		// Day 30: February stays at its day-28 total.
		expect(pace.baseline[29]).toEqual({day: 30, average: '5.17', low: '2.00', high: '10.00'});
		expect(pace.baseline[30]).toEqual({day: 31, average: '5.17', low: '2.01', high: '10.00'});
	});

	it('omits the low-high band with a single baseline month', () => {
		const pace = buildSpendingPace({
			daysInMonth: 30,
			throughDay: 30,
			daily: cents({}),
			baseline: [{days: 31, daily: cents({1: 500})}],
		});

		expect(pace.baseline[0]).toEqual({day: 1, average: '5.00', low: null, high: null});
		expect(pace.baseline).toHaveLength(30);
	});
});

describe('usual pace', () => {
	const covered = (from: string, to: string) => [{from, to}];

	it.each([
		[
			'a long history',
			covered('2024-03-09', '2026-10-14'),
			['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
		],
		['data from a 1st', covered('2026-07-01', '2026-10-14'), ['2026-07', '2026-08', '2026-09']],
		['data from mid-month', covered('2026-07-02', '2026-10-14'), ['2026-08', '2026-09']],
		[
			'data through a month end',
			covered('2024-03-09', '2026-09-30'),
			['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
		],
		[
			'data that stopped in August',
			covered('2024-03-09', '2026-08-20'),
			['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'],
		],
		[
			'a gap from 29 March to 1 June',
			[
				{from: '2026-01-03', to: '2026-03-28'},
				{from: '2026-06-02', to: '2026-10-14'},
			],
			['2026-02', '2026-07', '2026-08', '2026-09'],
		],
		['no data', [], []],
	])('averages the months before this one that the data covers whole, six at most: %s', (_, days, expected) => {
		expect(usualPaceMonths('2026-10', days)).toEqual(expected);
	});

	it('averages the newest six complete months, each through the same day of the month', () => {
		// 10.00 on the 1st and 90.00 on the 20th of every month April to September; March is a seventh month back.
		const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
		const spending = new Map([
			['2026-03', cents({1: 100_000})],
			...months.map((month, index) => [month, cents({1: 1000 + index * 120, 20: 9000})] as const),
			['2026-10', cents({2: 2500, 14: 500})],
		]);

		const pace = buildHomePace({
			month: '2026-10',
			lastCoveredDay: '2026-10-14',
			coveredDays: covered('2025-11-03', '2026-10-14'),
			spending,
		});

		expect(pace.usual).toMatchObject({months, byLastCoveredDay: '13.00', month: '103.00'});
		expect(pace.usual!.daily).toHaveLength(31);
		expect(pace.usual!.daily[13]).toEqual({day: 14, average: '13.00', low: '10.00', high: '16.00'});
		expect(pace.usual!.daily[19]).toEqual({day: 20, average: '103.00', low: '100.00', high: '106.00'});
		expect(pace.daily.at(-1)).toEqual({day: 14, spending: '5.00', cumulative: '30.00'});
	});

	it('shows no usual pace under two complete months', () => {
		const spending = new Map([
			['2026-08', cents({20: 5000})],
			['2026-09', cents({3: 1000})],
			['2026-10', cents({1: 700})],
		]);
		const pace = (from: string) =>
			buildHomePace({
				month: '2026-10',
				lastCoveredDay: '2026-10-05',
				coveredDays: covered(from, '2026-10-05'),
				spending,
			});

		expect(pace('2026-08-20').usual).toBeNull();
		expect(pace('2026-08-20').daily).toHaveLength(5);
		expect(pace('2026-08-01').usual).toMatchObject({months: ['2026-08', '2026-09'], byLastCoveredDay: '5.00'});
	});

	it('cuts this month at the last covered day, and covers none of it when that day is in an earlier month', () => {
		const spending = new Map([
			['2026-08', cents({1: 1000})],
			['2026-09', cents({1: 3000})],
			['2026-10', cents({1: 500, 15: 400, 20: 99_900})],
		]);
		const through = (lastCoveredDay: string | null) =>
			buildHomePace({
				month: '2026-10',
				lastCoveredDay,
				coveredDays: lastCoveredDay ? covered('2026-08-01', lastCoveredDay) : [],
				spending,
			});

		expect(through('2026-10-15').daily).toHaveLength(15);
		expect(through('2026-10-15').daily.at(-1)).toEqual({day: 15, spending: '4.00', cumulative: '9.00'});
		expect(through('2026-09-30')).toEqual({
			daily: [],
			usual: expect.objectContaining({byLastCoveredDay: '0.00', month: '20.00'}),
		});
		expect(through(null).daily).toEqual([]);
	});
});
