import {FILE_ANCHOR_MAX_DAYS, StatedBalanceRow, findFileAnchor} from './file-account-balance';

const row = (bookingDate: string, amount: string, balanceAfter: string): StatedBalanceRow => ({
	bookingDate,
	amount,
	balanceAfter,
});

describe('findFileAnchor', () => {
	it("takes a single row's balance after as its day's closing balance", () => {
		expect(findFileAnchor([row('2026-03-02', '-12.50000000', '987.50000000')])).toEqual({
			date: '2026-03-02',
			amount: '987.50000000',
		});
	});

	it('takes the end of a chain of rows on one day, in any order, from the newest day', () => {
		expect(
			findFileAnchor([
				row('2026-03-01', '5.00', '1000.00'),
				row('2026-03-02', '2500.00', '2637.50'),
				row('2026-03-02', '-12.50', '987.50'),
				row('2026-03-02', '-850.00', '137.50'),
			]),
		).toEqual({date: '2026-03-02', amount: '2637.50000000'});
	});

	it('keeps a repeated balance that a loop returns to, and exact cents', () => {
		// 100.10 → 100.30 → 100.10 → 99.99: the loop cancels, the last row closes the day.
		expect(
			findFileAnchor([
				row('2026-03-02', '0.20', '100.30'),
				row('2026-03-02', '-0.20', '100.10'),
				row('2026-03-02', '-0.11', '99.99'),
			]),
		).toEqual({date: '2026-03-02', amount: '99.99000000'});
	});

	it("falls back a day when a day's bookings cancel out in a loop", () => {
		expect(
			findFileAnchor([
				row('2026-03-01', '-3.00', '-1.50'),
				row('2026-03-02', '-20.00', '-21.50'),
				row('2026-03-02', '20.00', '-1.50'),
			]),
		).toEqual({date: '2026-03-01', amount: '-1.50000000'});
	});

	it('falls back a day when a day holds two chains that do not join, as when it is partly imported', () => {
		expect(
			findFileAnchor([
				row('2026-03-01', '10.00', '510.00'),
				row('2026-03-03', '-10.00', '500.00'),
				row('2026-03-03', '-20.00', '440.00'),
			]),
		).toEqual({date: '2026-03-01', amount: '510.00000000'});
	});

	it(`has no anchor when none of the newest ${FILE_ANCHOR_MAX_DAYS} days with balances closes unambiguously`, () => {
		const ambiguousDays = Array.from({length: FILE_ANCHOR_MAX_DAYS}, (_, index) => {
			const date = `2026-04-${String(index + 1).padStart(2, '0')}`;
			return [row(date, '-1.00', '99.00'), row(date, '1.00', '100.00')];
		}).flat();

		expect(findFileAnchor([row('2026-03-31', '1.00', '100.00'), ...ambiguousDays])).toBeNull();
		expect(findFileAnchor(ambiguousDays.slice(2))).toBeNull();
		expect(findFileAnchor([row('2026-03-31', '1.00', '100.00'), ...ambiguousDays.slice(2)])).toEqual({
			date: '2026-03-31',
			amount: '100.00000000',
		});
		expect(findFileAnchor([])).toBeNull();
	});
});
