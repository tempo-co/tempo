import {
	averageCents,
	buildSpendingPace,
	daysInMonth,
	divideRounded,
	formatCents,
	medianCents,
	parseCents,
	previousMonths,
} from './bank-transaction-summary';

const cents = (entries: Record<number, number>) =>
	new Map(Object.entries(entries).map(([day, value]) => [Number(day), BigInt(value)]));

describe('bank transaction summary', () => {
	it.each([
		['2026-01', 3, ['2025-10', '2025-11', '2025-12']],
		['2026-10', 3, ['2026-07', '2026-08', '2026-09']],
		['2026-03', 1, ['2026-02']],
	])('lists the %s previous %s months oldest first', (month, count, expected) => {
		expect(previousMonths(month, count)).toEqual(expected);
	});

	it.each([
		['2026-02', 28],
		['2028-02', 29],
		['2026-09', 30],
		['2026-10', 31],
	])('counts the days of %s', (month, expected) => {
		expect(daysInMonth(month)).toBe(expected);
	});

	it.each([
		[0n, '0.00'],
		[-1n, '-0.01'],
		[5n, '0.05'],
		[-123456n, '-1234.56'],
		[100n, '1.00'],
	])('formats %s cents as %s', (value, expected) => {
		expect(formatCents(value)).toBe(expected);
	});

	it.each([
		['12.34', 1234n],
		['-0.01', -1n],
		['0', 0n],
		['-5.5', -550n],
		['7', 700n],
	])('parses %s into cents', (value, expected) => {
		expect(parseCents(value)).toBe(expected);
	});

	it('rejects amounts with more than two decimals', () => {
		expect(() => parseCents('1.005')).toThrow();
	});

	it.each([
		[[100n, 200n], 150n],
		[[1n, 2n], 2n],
		[[-1n, -2n], -2n],
		[[1n, 1n, 2n], 1n],
		[[10n], 10n],
	])('averages %s to %s cents, rounding half away from zero', (values, expected) => {
		expect(averageCents(values)).toBe(expected);
	});

	it.each([
		[1n, 2n, 1n],
		[-1n, 2n, -1n],
		[4n, 3n, 1n],
		[-4n, 3n, -1n],
	])('divides %s by %s in whole cents, rounding half away from zero', (value, divisor, expected) => {
		expect(divideRounded(value, divisor)).toBe(expected);
	});

	it.each([
		[[4n, 1n, 2n], 2n],
		[[2n, 1n], 2n],
		[[-2n, -1n], -2n],
		[[9007199254740993n, 9007199254740994n], 9007199254740994n],
	])('takes the median of %s in whole cents', (values, expected) => {
		expect(medianCents(values)).toBe(expected);
	});

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
