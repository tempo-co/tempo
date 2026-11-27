import {
	averageCents,
	daysInMonth,
	divideRounded,
	formatCents,
	medianCents,
	parseCents,
	periodWindows,
	previousMonths,
} from './bank-transaction-summary';

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

	it('walks the periods history covers, clamping the last to the range and marking cut or running ones partial', () => {
		const starts = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'];

		expect(periodWindows('month', starts, '2026-04-10', '2026-04-10', '2026-02-15')).toEqual([
			{start: '2026-02-01', end: '2026-02-28', complete: false},
			{start: '2026-03-01', end: '2026-03-31', complete: true},
			{start: '2026-04-01', end: '2026-04-10', complete: false},
		]);
		expect(periodWindows('month', starts, '2026-04-10', '2026-04-10', null)).toEqual([]);
	});
});
