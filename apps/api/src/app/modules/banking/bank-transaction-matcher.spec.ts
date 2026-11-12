import {MatchExistingRow, MatchIncomingRow, matchTransactions} from './bank-transaction-matcher';

function incoming(overrides: Partial<MatchIncomingRow> = {}): MatchIncomingRow {
	return {
		amount: '-12.50',
		currency: 'EUR',
		bookingDate: '2026-03-02',
		valueDate: '2026-03-02',
		balanceAfter: null,
		reference: null,
		...overrides,
	};
}

let created = 0;
function existing(id: string, overrides: Partial<MatchIncomingRow> & {createdAt?: Date} = {}): MatchExistingRow {
	created += 1;
	return {...incoming(), id, createdAt: new Date(Date.UTC(2026, 2, 10, 0, 0, created)), ...overrides};
}

describe('matchTransactions', () => {
	it('matches a bank reference to the one existing row with that reference, amount and currency', () => {
		const outcomes = matchTransactions(
			[incoming({reference: 'REF-1', bookingDate: '2026-03-20', valueDate: null})],
			[
				existing('same-day', {}),
				existing('other-amount', {reference: 'REF-1', amount: '-12.51'}),
				existing('referenced', {reference: 'REF-1', bookingDate: '2026-03-02'}),
			],
		);

		expect(outcomes).toEqual([{kind: 'matched', existingId: 'referenced', step: 'reference'}]);
	});

	it('matches amount, value date and balance after when both sides carry them', () => {
		const outcomes = matchTransactions(
			[
				incoming({bookingDate: '2026-03-03', valueDate: '2026-03-01', balanceAfter: '987.5'}),
				incoming({bookingDate: '2026-03-03', valueDate: '2026-03-01', balanceAfter: null}),
			],
			[
				existing('without-balance', {bookingDate: null, valueDate: '2026-03-01'}),
				existing('with-balance', {bookingDate: null, valueDate: '2026-03-01', balanceAfter: '987.50000000'}),
			],
		);

		expect(outcomes[0]).toEqual({kind: 'matched', existingId: 'with-balance', step: 'balance'});
		// The second row has no balance, so it falls through to the date steps and finds the remaining row.
		expect(outcomes[1]).toEqual({kind: 'matched', existingId: 'without-balance', step: 'nearby'});
	});

	it('pairs same-day groups of unequal size in order and sends the leftover rows on', () => {
		const outcomes = matchTransactions(
			[incoming(), incoming(), incoming(), incoming({amount: '-3.00'})],
			[
				existing('second', {createdAt: new Date('2026-03-11T00:00:00Z')}),
				existing('first', {createdAt: new Date('2026-03-10T00:00:00Z')}),
			],
		);

		expect(outcomes).toEqual([
			{kind: 'matched', existingId: 'first', step: 'sameDay'},
			{kind: 'matched', existingId: 'second', step: 'sameDay'},
			{kind: 'new'},
			{kind: 'new'},
		]);
	});

	it('pairs a same-day row with the next existing row whose reference does not conflict with its own', () => {
		const outcomes = matchTransactions(
			[incoming({reference: 'REF-A'}), incoming({reference: 'REF-B'})],
			[existing('other-reference', {reference: 'REF-C'}), existing('no-reference')],
		);

		expect(outcomes).toEqual([
			{kind: 'matched', existingId: 'no-reference', step: 'sameDay'},
			{kind: 'doubtful', candidateIds: ['other-reference']},
		]);
	});

	it('holds a row as doubtful when its only candidate one to three days away carries a different reference', () => {
		const outcomes = matchTransactions(
			[
				incoming({amount: '-1.00', reference: 'FILE-1', bookingDate: '2026-03-03'}),
				incoming({amount: '-2.00', reference: 'FILE-2', bookingDate: '2026-03-04'}),
				incoming({amount: '-3.00', reference: ' FILE-3 ', bookingDate: '2026-03-05'}),
				incoming({amount: '-4.00', reference: 'FILE-4', bookingDate: '2026-03-04'}),
				incoming({amount: '-5.00', reference: null, bookingDate: '2026-03-04'}),
			],
			[
				existing('one-day', {amount: '-1.00', reference: 'BANK-1'}),
				existing('two-days', {amount: '-2.00', reference: 'BANK-2'}),
				existing('three-days', {amount: '-3.00', reference: 'BANK-3'}),
				existing('stored-without-reference', {amount: '-4.00', reference: '  '}),
				existing('incoming-without-reference', {amount: '-5.00', reference: 'BANK-5'}),
			],
			{uniqueCandidatesOnly: true},
		);

		expect(outcomes).toEqual([
			{kind: 'doubtful', candidateIds: ['one-day']},
			{kind: 'doubtful', candidateIds: ['two-days']},
			{kind: 'doubtful', candidateIds: ['three-days']},
			{kind: 'matched', existingId: 'stored-without-reference', step: 'nearby'},
			{kind: 'matched', existingId: 'incoming-without-reference', step: 'nearby'},
		]);
	});

	it('pairs only one-to-one same-day groups when asked for unique candidates, and holds larger groups as doubtful', () => {
		const outcomes = matchTransactions(
			[incoming(), incoming({amount: '-3.00'})],
			[existing('first'), existing('second'), existing('alone', {amount: '-3.00'})],
			{uniqueCandidatesOnly: true},
		);

		expect(outcomes).toEqual([
			{kind: 'doubtful', candidateIds: ['first', 'second']},
			{kind: 'matched', existingId: 'alone', step: 'sameDay'},
		]);
	});

	it('uses the value date as the day of a row without a booking date', () => {
		const outcomes = matchTransactions(
			[incoming({bookingDate: null, valueDate: '2026-03-02'})],
			[existing('booked', {bookingDate: '2026-03-02', valueDate: '2026-02-27'})],
		);

		expect(outcomes).toEqual([{kind: 'matched', existingId: 'booked', step: 'sameDay'}]);
	});

	it('matches the one candidate within three days, and nothing four days away', () => {
		const outcomes = matchTransactions(
			[incoming({bookingDate: '2026-03-05'}), incoming({amount: '-7.00', bookingDate: '2026-03-06'})],
			[existing('three-days', {}), existing('four-days', {amount: '-7.00'})],
		);

		expect(outcomes).toEqual([{kind: 'matched', existingId: 'three-days', step: 'nearby'}, {kind: 'new'}]);
	});

	it('holds a row with two candidates as doubtful, and a row whose only candidate another row shares', () => {
		const outcomes = matchTransactions(
			[
				incoming({bookingDate: '2026-03-04'}),
				incoming({amount: '-8.00', bookingDate: '2026-03-04'}),
				incoming({amount: '-8.00', bookingDate: '2026-03-05'}),
			],
			[
				existing('before', {bookingDate: '2026-03-02'}),
				existing('after', {bookingDate: '2026-03-06'}),
				existing('shared', {amount: '-8.00', bookingDate: '2026-03-03'}),
			],
		);

		expect(outcomes).toEqual([
			{kind: 'doubtful', candidateIds: ['before', 'after']},
			{kind: 'doubtful', candidateIds: ['shared']},
			{kind: 'doubtful', candidateIds: ['shared']},
		]);
	});

	it('claims each existing row once, so a repeated reference matches one row and the other is new', () => {
		const outcomes = matchTransactions(
			[incoming({reference: 'REF-1'}), incoming({reference: 'REF-1'})],
			[existing('only', {reference: 'REF-1'})],
		);

		expect(outcomes).toEqual([{kind: 'matched', existingId: 'only', step: 'reference'}, {kind: 'new'}]);
	});

	it('compares amounts as signed decimals within one currency', () => {
		const outcomes = matchTransactions(
			[incoming({amount: '10.5'}), incoming({amount: '-10.50'}), incoming({amount: '10.5', currency: 'USD'})],
			[existing('credit', {amount: '10.50000000'})],
		);

		expect(outcomes).toEqual([
			{kind: 'matched', existingId: 'credit', step: 'sameDay'},
			{kind: 'new'},
			{kind: 'new'},
		]);
	});

	it('calls a row with no candidate new', () => {
		expect(matchTransactions([incoming()], [])).toEqual([{kind: 'new'}]);
	});
});
