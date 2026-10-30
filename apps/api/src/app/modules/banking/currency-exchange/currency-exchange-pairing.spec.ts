import {CurrencyExchangeLeg, pairCurrencyExchanges} from './currency-exchange-pairing';

const CONNECTION = 'cccccccc-0000-4000-8000-000000000001';
const OTHER_CONNECTION = 'cccccccc-0000-4000-8000-000000000002';

let sequence = 0;
function leg(overrides: Partial<CurrencyExchangeLeg> & Pick<CurrencyExchangeLeg, 'indicator'>): CurrencyExchangeLeg {
	sequence += 1;
	return {
		id: `dddddddd-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
		connectionId: CONNECTION,
		date: '2026-01-10',
		currency: overrides.indicator === 'DBIT' ? 'EUR' : 'USD',
		targetCurrency: 'USD',
		amount: overrides.indicator === 'DBIT' ? '-10.00' : '11.00',
		baseAmount: '-10.00',
		...overrides,
	};
}

/** A debit in EUR and a credit in USD whose base amounts are given in EUR. */
function exchange(debitBase: string, creditBase: string, overrides: Partial<CurrencyExchangeLeg> = {}) {
	return [
		leg({indicator: 'DBIT', amount: `-${debitBase}`, baseAmount: `-${debitBase}`, ...overrides}),
		leg({indicator: 'CRDT', amount: creditBase, baseAmount: creditBase, ...overrides}),
	] as const;
}

function pairs(legs: readonly CurrencyExchangeLeg[]) {
	return Object.fromEntries(pairCurrencyExchanges(legs));
}

describe('pairCurrencyExchanges', () => {
	it('links the only debit and credit of a day and target currency both ways', () => {
		const [debit, credit] = exchange('10.00', '9.00');

		expect(pairs([debit, credit])).toEqual({[debit.id]: credit.id, [credit.id]: debit.id});
	});

	it('links a lone pair without base amounts', () => {
		const [debit, credit] = exchange('10.00', '9.00');

		expect(
			pairs([
				{...debit, baseAmount: null},
				{...credit, baseAmount: null},
			]),
		).toEqual({
			[debit.id]: credit.id,
			[credit.id]: debit.id,
		});
	});

	it('keeps exchanges apart by connection, day and target currency', () => {
		const [debit, credit] = exchange('10.00', '10.00');
		const [otherConnectionDebit] = exchange('10.00', '10.00', {connectionId: OTHER_CONNECTION});
		const [, otherDayCredit] = exchange('10.00', '10.00', {date: '2026-01-11'});
		const [otherTargetDebit] = exchange('10.00', '10.00', {targetCurrency: 'GBP'});

		expect(pairs([debit, credit, otherConnectionDebit, otherDayCredit, otherTargetDebit])).toEqual({
			[debit.id]: credit.id,
			[credit.id]: debit.id,
		});
	});

	it('matches several same-day exchanges by the closest base amounts', () => {
		const [smallDebit, smallCredit] = exchange('20.00', '19.90');
		const [largeDebit, largeCredit] = exchange('100.00', '99.60');
		const [middleDebit, middleCredit] = exchange('50.00', '50.10');

		expect(pairs([largeCredit, smallDebit, middleCredit, largeDebit, smallCredit, middleDebit])).toEqual({
			[smallDebit.id]: smallCredit.id,
			[smallCredit.id]: smallDebit.id,
			[middleDebit.id]: middleCredit.id,
			[middleCredit.id]: middleDebit.id,
			[largeDebit.id]: largeCredit.id,
			[largeCredit.id]: largeDebit.id,
		});
	});

	it('links repeated identical exchanges, since every assignment looks the same', () => {
		const [firstDebit, firstCredit] = exchange('25.00', '24.80');
		const [secondDebit, secondCredit] = exchange('25.00', '24.80');

		const result = pairs([firstDebit, firstCredit, secondDebit, secondCredit]);

		expect(Object.keys(result)).toHaveLength(4);
		expect(result[firstDebit.id]).not.toBe(result[secondDebit.id]);
		expect(result[result[firstDebit.id]]).toBe(firstDebit.id);
	});

	it('leaves a close call between two assignments unlinked', () => {
		// Swapping the credits fits only about 1% worse: within normal exchange spreads.
		const [firstDebit, firstCredit] = exchange('100.00', '99.00');
		const [secondDebit, secondCredit] = exchange('101.00', '100.50');

		expect(pairs([firstDebit, firstCredit, secondDebit, secondCredit])).toEqual({});
	});

	it('leaves a day unlinked when a multi-exchange leg has no base amount yet', () => {
		const [firstDebit, firstCredit] = exchange('20.00', '20.00');
		const [secondDebit, secondCredit] = exchange('100.00', '100.00');

		expect(pairs([firstDebit, firstCredit, secondDebit, {...secondCredit, baseAmount: null}])).toEqual({});
	});

	it('leaves a day unlinked when debits and credits do not balance', () => {
		const [debit, credit] = exchange('20.00', '20.00');
		const [extraDebit] = exchange('100.00', '100.00');

		expect(pairs([debit, credit, extraDebit])).toEqual({});
	});

	it('skips legs without a date or target currency', () => {
		const [debit, credit] = exchange('20.00', '20.00', {date: null});
		const [otherDebit, otherCredit] = exchange('20.00', '20.00', {targetCurrency: null});

		expect(pairs([debit, credit, otherDebit, otherCredit])).toEqual({});
	});

	it('returns the same pairs regardless of input order', () => {
		const legs = [...exchange('20.00', '19.90'), ...exchange('100.00', '99.60'), ...exchange('20.00', '19.90')];
		const expected = pairs(legs);

		expect(Object.keys(expected)).toHaveLength(6);
		expect(pairs([...legs].reverse())).toEqual(expected);
	});
});
