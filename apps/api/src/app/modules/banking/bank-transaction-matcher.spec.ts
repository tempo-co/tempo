import {
	MatchExistingRow,
	MatchIncomingRow,
	REFERENCE_FALLBACK_MIN_PROBED_ROWS,
	matchStatementRows,
	matchTransactions,
	probeReferences,
} from './bank-transaction-matcher';

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
function existing(id: string, overrides: Partial<Omit<MatchExistingRow, 'id'>> = {}): MatchExistingRow {
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

/** `count` rows, one a day from 2026-04-01 at amounts -1.00, -2.00…, the file's references against other ones stored. */
function referencedTwins(count: number, existingReference = (day: number) => `BANK-${day}`) {
	const rows = Array.from({length: count}, (_, day) => ({
		amount: `-${day + 1}.00`,
		bookingDate: new Date(Date.UTC(2026, 3, 1 + day)).toISOString().slice(0, 10),
		valueDate: null,
	}));
	return {
		incoming: rows.map((row, day) => incoming({...row, reference: `FILE-${day}`})),
		existing: rows.map((row, day) => existing(`twin-${day}`, {...row, reference: existingReference(day)})),
	};
}

describe('probeReferences', () => {
	it('probes each referenced row with a look-alike within three days carrying a bank reference, and counts the rows whose reference the bank stored', () => {
		const probe = probeReferences(
			[
				incoming({reference: 'FILE-1'}),
				incoming({reference: null}),
				incoming({amount: '-1.00', reference: 'FILE-2'}),
				incoming({amount: '-2.00', reference: 'FILE-3'}),
				incoming({amount: '-3.00', reference: 'FILE-4', bookingDate: '2026-03-06', valueDate: null}),
				incoming({amount: '-4.00', reference: ' SHARED '}),
				incoming({amount: '-5.00', reference: 'FILE-5'}),
			],
			[
				existing('referenced', {reference: 'BANK-1'}),
				existing('without-reference', {amount: '-1.00', reference: ' '}),
				existing('four-days-away', {amount: '-2.00', reference: 'BANK-3', bookingDate: '2026-03-06'}),
				existing('three-days-away', {amount: '-3.00', reference: 'BANK-4', bookingDate: '2026-03-03'}),
				existing('other-amount', {amount: '-99.00', reference: 'SHARED'}),
				// An earlier import's rows are in a file's numbering, not the bank's: they neither probe nor count.
				existing('imported', {amount: '-5.00', reference: 'FILE-OLD', imported: true}),
				existing('imported-same-reference', {amount: '-99.00', reference: 'FILE-1', imported: true}),
			],
		);

		// Probed: FILE-1 and FILE-4. SHARED has no look-alike to probe, but the bank stored its reference.
		expect(probe).toEqual({probedRows: 2, rowsWithStoredReference: 1});
	});
});

describe('matchStatementRows', () => {
	it("sets aside the bank's references once 20 rows were probed and none is the file's, matching by date and holding same-day look-alike groups", () => {
		// With the two look-alikes and the row two days from its twin, exactly the 20 rows needed are probed.
		const twins = referencedTwins(REFERENCE_FALLBACK_MIN_PROBED_ROWS - 3);
		const lookAlikes = {amount: '-2.50', bookingDate: '2026-05-01', valueDate: null};
		const day = (bookingDate: string) => ({bookingDate, valueDate: null});

		const result = matchStatementRows(
			[
				...twins.incoming,
				incoming({...lookAlikes, reference: 'FILE-C1'}),
				incoming({...lookAlikes, reference: 'FILE-C2'}),
				incoming({amount: '-7.77', ...day('2026-05-10'), reference: 'FILE-N'}),
				incoming({amount: '-8.88', ...day('2026-05-10'), reference: 'FILE-I'}),
			],
			[
				...twins.existing,
				existing('coffee-1', {...lookAlikes, reference: 'BANK-C1'}),
				existing('coffee-2', {...lookAlikes, reference: 'BANK-C2'}),
				existing('two-days-away', {amount: '-7.77', ...day('2026-05-12'), reference: 'BANK-N'}),
				// An earlier import of the same numbering stored this row: its reference still names another payment.
				existing('earlier-import', {
					amount: '-8.88',
					...day('2026-05-09'),
					reference: 'FILE-OLD',
					imported: true,
				}),
			],
		);

		expect(result.referencesSetAside).toBe(true);
		expect(result.outcomes).toEqual([
			...twins.existing.map(({id}) => ({kind: 'matched', existingId: id, step: 'sameDay'})),
			{kind: 'doubtful', candidateIds: ['coffee-1', 'coffee-2']},
			{kind: 'doubtful', candidateIds: ['coffee-1', 'coffee-2']},
			{kind: 'matched', existingId: 'two-days-away', step: 'nearby'},
			{kind: 'doubtful', candidateIds: ['earlier-import']},
		]);
	});

	it.each([
		{name: 'fewer than 20 rows were probed', twins: referencedTwins(REFERENCE_FALLBACK_MIN_PROBED_ROWS - 1)},
		{
			name: "one row's reference is stored",
			twins: referencedTwins(30, (day) => (day === 29 ? 'FILE-29' : `BANK-${day}`)),
		},
	])('keeps the references and runs the ladder unchanged when $name', ({twins}) => {
		const result = matchStatementRows(twins.incoming, twins.existing);

		expect(result).toEqual({
			referencesSetAside: false,
			outcomes: matchTransactions(twins.incoming, twins.existing),
		});
		expect(result.outcomes.filter(({kind}) => kind === 'doubtful').length).toBeGreaterThan(0);
	});
});
