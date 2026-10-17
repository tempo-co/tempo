import {type RecurringCandidate, detectRecurringSeries} from './recurring-series-detection';

const TODAY = '2026-10-17';
let nextId = 0;

function payment(date: string, amount: string, overrides: Partial<RecurringCandidate> = {}): RecurringCandidate {
	const cents = BigInt(Math.round(Number(amount) * 100));
	return {
		id: `row-${String(++nextId).padStart(4, '0')}`,
		bankAccountId: 'account-1',
		date,
		merchantKey: 'EXPENSE:example gym',
		currency: 'EUR',
		amountCents: cents,
		baseAmountCents: cents,
		name: 'Example Gym',
		...overrides,
	};
}

function monthly(day: number, months: string[], amount: string, overrides: Partial<RecurringCandidate> = {}) {
	return months.map((month) => payment(`${month}-${String(day).padStart(2, '0')}`, amount, overrides));
}

const MAY_TO_OCT = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

describe('detectRecurringSeries', () => {
	it('detects a fixed monthly payment with its next date and monthly cost', () => {
		const [series, ...rest] = detectRecurringSeries(monthly(3, MAY_TO_OCT, '29.99'), TODAY);

		expect(rest).toHaveLength(0);
		expect(series).toMatchObject({
			cadence: 'MONTHLY',
			amountKind: 'FIXED',
			direction: 'EXPENSE',
			typicalAmount: '29.99',
			monthlyEquivalent: 2999n,
			firstDate: '2026-05-03',
			lastDate: '2026-10-03',
			nextExpectedDate: '2026-11-03',
			status: 'ACTIVE',
			flags: [],
		});
		expect(series.transactionIds).toHaveLength(6);
	});

	it('tolerates drifting days and one skipped month', () => {
		const rows = [
			payment('2026-04-01', '12.00'),
			payment('2026-05-03', '12.00'),
			payment('2026-05-30', '12.00'),
			// July skipped.
			payment('2026-08-01', '12.00'),
			payment('2026-09-02', '12.00'),
			payment('2026-10-01', '12.00'),
		];

		expect(detectRecurringSeries(rows, TODAY)).toEqual([
			expect.objectContaining({cadence: 'MONTHLY', transactionIds: rows.map((row) => row.id)}),
		]);
	});

	it('needs three monthly payments', () => {
		expect(detectRecurringSeries(monthly(3, ['2026-08', '2026-09'], '9.99'), TODAY)).toEqual([]);
	});

	it('detects weekly and quarterly payments with their monthly equivalents', () => {
		const weekly = ['2026-09-19', '2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17'].map((date) =>
			payment(date, '6.00', {merchantKey: 'EXPENSE:example lessons'}),
		);
		const quarterly = ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'].map((date) =>
			payment(date, '90.00', {merchantKey: 'EXPENSE:example water'}),
		);

		const series = detectRecurringSeries([...weekly, ...quarterly], TODAY);

		expect(series).toEqual(
			expect.arrayContaining([
				expect.objectContaining({cadence: 'WEEKLY', monthlyEquivalent: 2600n, nextExpectedDate: '2026-10-24'}),
				expect.objectContaining({
					cadence: 'QUARTERLY',
					monthlyEquivalent: 3000n,
					nextExpectedDate: '2027-01-15',
				}),
			]),
		);
	});

	it('suggests a yearly series from two payments', () => {
		const rows = [payment('2025-03-10', '120.00'), payment('2026-03-12', '120.00')];

		expect(detectRecurringSeries(rows, TODAY)).toEqual([
			expect.objectContaining({cadence: 'YEARLY', monthlyEquivalent: 1000n, nextExpectedDate: '2027-03-11'}),
		]);
	});

	it('does not suggest a yearly series at a payee paid often in between', () => {
		const rows = [
			payment('2025-03-10', '120.00'),
			...['2025-05-02', '2025-07-19', '2025-09-08', '2026-01-23'].map((date) => payment(date, '18.40')),
			payment('2026-03-12', '120.00'),
		];

		expect(detectRecurringSeries(rows, TODAY)).toEqual([]);
	});

	it('keeps tracking a variable bill after an early run of a stable amount ends', () => {
		const rows = [
			...monthly(3, MAY_TO_OCT.slice(0, 3), '100.00', {merchantKey: 'EXPENSE:example energy'}),
			payment('2026-08-03', '200.00', {merchantKey: 'EXPENSE:example energy'}),
			payment('2026-09-03', '50.00', {merchantKey: 'EXPENSE:example energy'}),
			payment('2026-10-03', '300.00', {merchantKey: 'EXPENSE:example energy'}),
		];

		const result = detectRecurringSeries(rows, '2026-10-20');
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({amountKind: 'VARIABLE', status: 'ACTIVE'});
		expect(result[0].transactionIds).toHaveLength(6);
	});

	it('ignores irregular payments to the same shop', () => {
		const rows = ['2026-06-02', '2026-06-20', '2026-07-30', '2026-08-04', '2026-09-27', '2026-10-01'].map((date) =>
			payment(date, '15.00'),
		);

		expect(detectRecurringSeries(rows, TODAY)).toEqual([]);
	});

	it('splits two plans billed by one payee into separate series', () => {
		const rows = [...monthly(5, MAY_TO_OCT, '9.99'), ...monthly(5, MAY_TO_OCT, '49.00')];

		const series = detectRecurringSeries(rows, TODAY);

		expect(series.map((entry) => entry.typicalAmount).sort()).toEqual(['49.00', '9.99']);
		expect(new Set(series.map((entry) => entry.key)).size).toBe(2);
	});

	it('keeps a price step in one series and flags it', () => {
		const rows = [...monthly(8, MAY_TO_OCT.slice(0, 5), '10.00'), payment('2026-10-08', '11.50')];

		const [series, ...rest] = detectRecurringSeries(rows, TODAY);

		expect(rest).toHaveLength(0);
		expect(series).toMatchObject({
			typicalAmount: '10.00',
			latestAmount: '11.50',
			monthlyEquivalent: 1150n,
			flags: ['PRICE_INCREASED'],
		});
	});

	it('does not flag a small price change', () => {
		const rows = [...monthly(8, MAY_TO_OCT.slice(0, 5), '10.00'), payment('2026-10-08', '10.40')];

		expect(detectRecurringSeries(rows, TODAY)[0].flags).toEqual([]);
	});

	it('detects a monthly bill whose amount varies as one variable series', () => {
		const amounts = ['61.20', '95.40', '48.10', '120.00', '77.70', '88.30'];
		const rows = MAY_TO_OCT.map((month, index) => payment(`${month}-20`, amounts[index]));

		expect(detectRecurringSeries(rows, TODAY)).toEqual([
			expect.objectContaining({
				cadence: 'MONTHLY',
				amountKind: 'VARIABLE',
				typicalAmount: '83.00',
				monthlyEquivalent: 8300n,
				flags: [],
			}),
		]);
	});

	it('does not treat weekly variable spending as a bill', () => {
		const amounts = ['31.20', '55.10', '12.40', '80.00', '44.40'];
		const rows = ['2026-09-19', '2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17'].map((date, index) =>
			payment(date, amounts[index]),
		);

		expect(detectRecurringSeries(rows, TODAY)).toEqual([]);
	});

	it('flags a payment that is overdue', () => {
		const rows = monthly(1, ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'], '20.00');

		expect(detectRecurringSeries(rows, TODAY)[0]).toMatchObject({
			nextExpectedDate: '2026-10-01',
			status: 'ACTIVE',
			flags: ['OVERDUE'],
		});
	});

	it('marks a series ended after two missed cycles, without flagging its old price', () => {
		const rows = [...monthly(1, ['2026-03', '2026-04', '2026-05'], '20.00'), payment('2026-06-01', '22.00')];

		expect(detectRecurringSeries(rows, TODAY)[0]).toMatchObject({status: 'ENDED', flags: []});
	});

	it('clamps a month-end payment day to shorter months', () => {
		const rows = [payment('2026-07-31', '5.00'), payment('2026-08-31', '5.00'), payment('2026-09-30', '5.00')];

		expect(detectRecurringSeries(rows, TODAY)[0].nextExpectedDate).toBe('2026-10-31');
		expect(detectRecurringSeries(rows.slice(0, 2), TODAY)).toEqual([]);
	});

	it('never mixes currencies and leaves the monthly cost empty until every row is converted', () => {
		const rows = [
			...monthly(2, MAY_TO_OCT, '10.00'),
			...monthly(2, MAY_TO_OCT, '10.00', {currency: 'GBP', baseAmountCents: 1150n}),
		];
		rows[rows.length - 1].baseAmountCents = null;

		const series = detectRecurringSeries(rows, TODAY);

		expect(series.map(({currency, monthlyEquivalent}) => ({currency, monthlyEquivalent}))).toEqual(
			expect.arrayContaining([
				{currency: 'EUR', monthlyEquivalent: 1000n},
				{currency: 'GBP', monthlyEquivalent: null},
			]),
		);
	});

	it('reports recurring income with its direction', () => {
		const rows = [
			...monthly(25, MAY_TO_OCT.slice(0, 5), '2500.00', {merchantKey: 'INCOME:example employer'}),
			payment('2026-10-25', '2700.00', {merchantKey: 'INCOME:example employer'}),
		];

		expect(detectRecurringSeries(rows, '2026-10-26')[0]).toMatchObject({
			direction: 'INCOME',
			cadence: 'MONTHLY',
			flags: [],
		});
	});

	it('keeps the series key when a new payment arrives', () => {
		const rows = monthly(3, MAY_TO_OCT.slice(0, 5), '29.99');
		const [before] = detectRecurringSeries(rows, '2026-09-20');
		const [after] = detectRecurringSeries([...rows, payment('2026-10-03', '29.99')], TODAY);

		expect(after.key).toBe(before.key);
		expect(after.transactionIds).toHaveLength(6);
	});

	it('groups a person named in a transfer description with their later counterparty name', () => {
		const older = monthly(28, ['2026-05', '2026-06', '2026-07', '2026-08'], '650.00', {
			merchantKey: 'EXPENSE:transfer to alex-sam exämple',
			name: 'Transfer to ALEX-SAM EXAMPLE',
		});
		const newer = monthly(28, ['2026-09'], '650.00', {merchantKey: 'EXPENSE:alex example', name: 'Alex Example'});

		expect(detectRecurringSeries([...older, ...newer], TODAY)).toEqual([
			expect.objectContaining({
				name: 'Alex Example',
				status: 'ACTIVE',
				transactionIds: [...older, ...newer].map(({id}) => id),
			}),
		]);
	});

	it('groups transfers from a person the same way', () => {
		const older = monthly(1, ['2026-05', '2026-06', '2026-07'], '40.00', {
			merchantKey: 'INCOME:transfer from alex-sam example',
			name: 'Transfer from ALEX-SAM EXAMPLE',
		});
		const newer = monthly(1, ['2026-08', '2026-09', '2026-10'], '40.00', {
			merchantKey: 'INCOME:alex example',
			name: 'Alex Example',
		});

		expect(detectRecurringSeries([...older, ...newer], TODAY)).toEqual([
			expect.objectContaining({direction: 'INCOME', transactionIds: [...older, ...newer].map(({id}) => id)}),
		]);
	});

	it('keeps each bank account’s payments to one payee apart', () => {
		const bill = monthly(23, MAY_TO_OCT, '12.00', {merchantKey: 'EXPENSE:example mobile'});
		// Irregular top-ups to the same payee from another account.
		const topUps = ['2026-05-01', '2026-05-09', '2026-06-14', '2026-08-02', '2026-08-05'].map((date) =>
			payment(date, '2.50', {merchantKey: 'EXPENSE:example mobile', bankAccountId: 'account-2'}),
		);

		expect(detectRecurringSeries([...bill, ...topUps], TODAY)).toEqual([
			expect.objectContaining({cadence: 'MONTHLY', transactionIds: bill.map(({id}) => id)}),
		]);
	});

	it('keeps a person’s payments and money received apart, and merchants with similar names apart', () => {
		const rows = [
			...monthly(28, MAY_TO_OCT, '650.00', {merchantKey: 'EXPENSE:transfer to alex-sam example'}),
			...monthly(2, MAY_TO_OCT, '20.00', {merchantKey: 'INCOME:alex example'}),
			// Shares the first and last word of a merchant but names no transferred-to person.
			...monthly(5, MAY_TO_OCT, '9.99', {merchantKey: 'EXPENSE:example cloud storage'}),
			...monthly(6, MAY_TO_OCT, '4.99', {merchantKey: 'EXPENSE:example storage'}),
		];

		expect(detectRecurringSeries(rows, TODAY).map(({transactionIds}) => transactionIds.length)).toEqual([
			6, 6, 6, 6,
		]);
	});
});
