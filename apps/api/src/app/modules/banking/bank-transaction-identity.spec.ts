import {createBankTransaction} from '../../../../test/fixtures/bank-transaction.fixture';
import type {BankTransactionIdentityInput} from './bank-transaction-identity';
import {
	allocateNextBankTransactionStableIdentityKey,
	assignBankTransactionStableIdentityKeys,
	createBankTransactionStableIdentityKeyForGroup,
	isLegacyBankTransactionDedupeKey,
} from './bank-transaction-identity';

describe('bank transaction stable identity assignment', () => {
	it.each([
		['another bank account', {bankAccountId: '10000000-0000-4000-8000-000000000099'}],
		['another reference', {entryReference: 'different-reference'}],
		['an empty reference', {entryReference: ''}],
		['another amount', {amount: '-99.00'}],
		['another currency', {currency: 'USD'}],
		['another direction', {creditDebitIndicator: 'CRDT'}],
		['another booking date', {bookingDate: '2026-09-03'}],
		['another transaction date', {transactionDate: '2026-09-03'}],
		['changed payment content', {description: 'Different payment'}],
		['a non-booked status', {transactionStatus: 'PDNG'}],
	])('does not reconcile pending across groups with %s', (_label, overrides) => {
		const pending = createBankTransaction({
			entryReference: 'synthetic-transition',
			transactionStatus: 'PDNG',
			transactionDate: null,
			bookingDate: '2026-09-01',
			valueDate: null,
		});
		const [stored] = assignBankTransactionStableIdentityKeys([pending]);
		const incoming = {...pending, transactionStatus: 'BOOK', valueDate: '2026-09-02', ...overrides};
		const [updated] = assignBankTransactionStableIdentityKeys([incoming], [stored]);
		expect(updated.stableIdentityKey).not.toBe(stored.stableIdentityKey);
	});

	it('reconciles a booked update when pending valueDate was derived from transactionDate', () => {
		const pending = createBankTransaction({
			entryReference: 'synthetic-value-date-fallback',
			transactionStatus: 'PDNG',
			transactionDate: '2026-09-01',
			bookingDate: '2026-09-02',
			valueDate: '2026-09-01',
		});
		const [stored] = assignBankTransactionStableIdentityKeys([pending]);
		const booked = {...pending, transactionStatus: 'BOOK', valueDate: '2026-09-03'};
		const [updated] = assignBankTransactionStableIdentityKeys([booked], [stored]);

		expect(updated.stableIdentityKey).toBe(stored.stableIdentityKey);
		expect(updated.stableIdentityGroupKey).not.toBe(stored.stableIdentityGroupKey);
	});

	it('does not reconcile when pending valueDate is distinct from transactionDate', () => {
		const pending = createBankTransaction({
			entryReference: 'synthetic-independent-value-date',
			transactionStatus: 'PDNG',
			transactionDate: '2026-09-01',
			bookingDate: '2026-09-02',
			valueDate: '2026-09-03',
		});
		const [stored] = assignBankTransactionStableIdentityKeys([pending]);
		const booked = {...pending, transactionStatus: 'BOOK', valueDate: '2026-09-04'};
		const [updated] = assignBankTransactionStableIdentityKeys([booked], [stored]);

		expect(updated.stableIdentityKey).not.toBe(stored.stableIdentityKey);
	});

	it('does not reconcile ambiguous repeated pending or incoming booked occurrences', () => {
		const pending = createBankTransaction({
			entryReference: 'synthetic-repeated',
			transactionStatus: 'PDNG',
			valueDate: null,
		});
		const booked = {...pending, transactionStatus: 'BOOK', valueDate: '2026-09-02'};
		const stored = assignBankTransactionStableIdentityKeys([pending, pending]);
		const oldKeys = new Set(stored.map(({stableIdentityKey}) => stableIdentityKey));
		expect(oldKeys.has(assignBankTransactionStableIdentityKeys([booked], stored)[0].stableIdentityKey)).toBe(false);
		const [single] = stored;
		const incoming = assignBankTransactionStableIdentityKeys([booked, booked], [single]);
		expect(incoming.every(({stableIdentityKey}) => stableIdentityKey !== single.stableIdentityKey)).toBe(true);
		expect(new Set(incoming.map(({stableIdentityKey}) => stableIdentityKey)).size).toBe(2);
	});

	it('keeps simultaneous pending and booked rows separate', () => {
		const pending = createBankTransaction({
			entryReference: 'synthetic-simultaneous',
			transactionStatus: 'PDNG',
			valueDate: null,
		});
		const [stored] = assignBankTransactionStableIdentityKeys([pending]);
		const incoming = assignBankTransactionStableIdentityKeys(
			[pending, {...pending, transactionStatus: 'BOOK', valueDate: '2026-09-02'}],
			[stored],
		);
		expect(incoming[0].stableIdentityKey).toBe(stored.stableIdentityKey);
		expect(incoming[1].stableIdentityKey).not.toBe(stored.stableIdentityKey);
	});

	it('reconciles distinct payment content independently despite a shared reference', () => {
		const first = createBankTransaction({
			entryReference: 'synthetic-shared',
			transactionStatus: 'PDNG',
			valueDate: null,
			description: 'Payment A',
		});
		const second = {...first, description: 'Payment B'};
		const stored = assignBankTransactionStableIdentityKeys([first, second]);
		const incoming = assignBankTransactionStableIdentityKeys(
			[second, first].map((row) => ({...row, transactionStatus: 'BOOK', valueDate: '2026-09-02'})),
			stored,
		);
		expect(incoming.map(({stableIdentityKey}) => stableIdentityKey)).toEqual([
			stored[1].stableIdentityKey,
			stored[0].stableIdentityKey,
		]);
	});

	it('assigns repeated-entry occurrences independently of provider response order', () => {
		const sharedFields: BankTransactionIdentityInput = {
			bankAccountId: '10000000-0000-4000-8000-000000000001',
			entryReference: 'shared-entry-reference',
			transactionDate: '2026-09-01',
			bookingDate: '2026-09-01',
			valueDate: '2026-09-01',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bankTransactionCode: 'PMNT',
			bankTransactionSubCode: 'CARD',
			bankTransactionDescription: 'Synthetic repeated payment',
			description: 'Synthetic repeated payment A',
			counterpartyName: 'Synthetic Counterparty',
			merchantLocation: null,
			merchantCategoryCode: null,
			remittanceInformation: null,
			instructedAmount: null,
			instructedCurrency: null,
			exchangeRate: null,
			exchangeRateUnitCurrency: null,
			exchangeRateType: null,
			referenceNumber: 'synthetic-reference-a',
			referenceNumberScheme: 'SYNTHETIC',
		};
		const first = {...sharedFields};
		const second = {
			...sharedFields,
			description: 'Synthetic repeated payment B',
			referenceNumber: 'synthetic-reference-b',
		};
		const identitiesByReference = (transactions: BankTransactionIdentityInput[]) =>
			new Map(
				assignBankTransactionStableIdentityKeys(transactions).map(({referenceNumber, stableIdentityKey}) => [
					referenceNumber ?? '',
					stableIdentityKey,
				]),
			);

		expect(identitiesByReference([first, second])).toEqual(identitiesByReference([second, first]));
	});

	it('reuses a unique no-reference core match when provider details change', () => {
		const first = {
			bankAccountId: '10000000-0000-4000-8000-000000000001',
			entryReference: null,
			transactionDate: '2026-09-01',
			bookingDate: '2026-09-01',
			valueDate: '2026-09-01',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bankTransactionCode: null,
			bankTransactionSubCode: null,
			bankTransactionDescription: null,
			description: 'Synthetic detail before update',
			counterpartyName: 'Synthetic counterparty before update',
			merchantLocation: null,
			merchantCategoryCode: null,
			remittanceInformation: null,
			instructedAmount: null,
			instructedCurrency: null,
			exchangeRate: null,
			exchangeRateUnitCurrency: null,
			exchangeRateType: null,
			referenceNumber: null,
			referenceNumberScheme: null,
		};
		const initial = assignBankTransactionStableIdentityKeys([first]);
		const refreshed = assignBankTransactionStableIdentityKeys(
			[
				{
					...first,
					description: 'Synthetic detail after update',
					counterpartyName: 'Synthetic counterparty after update',
				},
			],
			initial,
		);

		expect(refreshed[0].stableIdentityKey).toBe(initial[0].stableIdentityKey);
	});

	it('keeps prior occurrence keys attached when one repeated-reference row changes mutable details', () => {
		const sharedFields: BankTransactionIdentityInput = {
			bankAccountId: '10000000-0000-4000-8000-000000000001',
			entryReference: 'shared-entry-reference',
			transactionDate: '2026-09-01',
			bookingDate: '2026-09-01',
			valueDate: '2026-09-01',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bankTransactionCode: 'PMNT',
			bankTransactionSubCode: 'CARD',
			bankTransactionDescription: 'Synthetic repeated payment',
			description: 'Alpha',
			counterpartyName: 'Synthetic Counterparty',
			merchantLocation: null,
			merchantCategoryCode: null,
			remittanceInformation: null,
			instructedAmount: null,
			instructedCurrency: null,
			exchangeRate: null,
			exchangeRateUnitCurrency: null,
			exchangeRateType: null,
			referenceNumber: 'reference-a',
			referenceNumberScheme: 'SYNTHETIC',
		};
		const first = {...sharedFields, logicalRow: 'first'};
		const second = {
			...sharedFields,
			logicalRow: 'second',
			description: 'Beta',
			referenceNumber: 'reference-b',
		};
		const initial = assignBankTransactionStableIdentityKeys([first, second]);
		const initialByRow = new Map(initial.map(({logicalRow, stableIdentityKey}) => [logicalRow, stableIdentityKey]));
		const persistedRows = initial.map((transaction) => ({
			...transaction,
			transactionDate: new Date('2026-09-01T00:00:00.000Z'),
			bookingDate: new Date('2026-09-01T00:00:00.000Z'),
			valueDate: new Date('2026-09-01T00:00:00.000Z'),
		})) as unknown as typeof initial;
		const refreshed = assignBankTransactionStableIdentityKeys(
			[{...first, description: 'Zulu', referenceNumber: 'reference-z'}, second],
			persistedRows,
		);

		expect(new Map(refreshed.map(({logicalRow, stableIdentityKey}) => [logicalRow, stableIdentityKey]))).toEqual(
			initialByRow,
		);

		const dateStyleRows = initial.map((transaction) => ({
			...transaction,
			transactionDate: null,
			bookingDate: null,
			valueDate: null,
		}));
		const refreshedWithUnparsedDatabaseDates = assignBankTransactionStableIdentityKeys(
			[first, second],
			dateStyleRows,
		);

		expect(
			new Map(
				refreshedWithUnparsedDatabaseDates.map(({logicalRow, stableIdentityKey}) => [
					logicalRow,
					stableIdentityKey,
				]),
			),
		).toEqual(initialByRow);
	});

	it('matches an existing occurrence when PostgreSQL renders stored dates in a different DateStyle', () => {
		const transaction: BankTransactionIdentityInput = {
			bankAccountId: '10000000-0000-4000-8000-000000000001',
			entryReference: 'synthetic-entry-reference',
			transactionDate: '2026-09-01',
			bookingDate: '2026-09-01',
			valueDate: '2026-09-01',
			amount: '-12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bankTransactionCode: 'PMNT',
			bankTransactionSubCode: 'CARD',
			bankTransactionDescription: 'Synthetic transaction',
			description: 'Synthetic detail',
			counterpartyName: 'Synthetic counterparty',
			merchantLocation: null,
			merchantCategoryCode: null,
			remittanceInformation: null,
			instructedAmount: null,
			instructedCurrency: null,
			exchangeRate: null,
			exchangeRateUnitCurrency: null,
			exchangeRateType: null,
			referenceNumber: 'synthetic-reference',
			referenceNumberScheme: 'SYNTHETIC',
		};
		const [initial] = assignBankTransactionStableIdentityKeys([transaction]);
		const persisted = {
			...initial,
			transactionDate: '01/09/2026',
			bookingDate: '01/09/2026',
			valueDate: '01/09/2026',
		};
		const [refreshed] = assignBankTransactionStableIdentityKeys([transaction], [persisted]);

		expect(refreshed.stableIdentityKey).toBe(initial.stableIdentityKey);
	});

	it('does not recycle occurrence keys when multiple same-core rows change ambiguously', () => {
		const sharedFields: BankTransactionIdentityInput = {
			bankAccountId: '10000000-0000-4000-8000-000000000001',
			entryReference: null,
			transactionDate: '2026-09-01',
			bookingDate: '2026-09-01',
			valueDate: '2026-09-01',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bankTransactionCode: null,
			bankTransactionSubCode: null,
			bankTransactionDescription: null,
			description: 'Synthetic payment A',
			counterpartyName: null,
			merchantLocation: null,
			merchantCategoryCode: null,
			remittanceInformation: null,
			instructedAmount: null,
			instructedCurrency: null,
			exchangeRate: null,
			exchangeRateUnitCurrency: null,
			exchangeRateType: null,
			referenceNumber: null,
			referenceNumberScheme: null,
		};
		const initial = assignBankTransactionStableIdentityKeys([
			{...sharedFields, logicalRow: 'first'},
			{...sharedFields, logicalRow: 'second', description: 'Synthetic payment B'},
		]);
		const refreshed = assignBankTransactionStableIdentityKeys(
			[
				{...sharedFields, logicalRow: 'first', description: 'Synthetic payment C'},
				{...sharedFields, logicalRow: 'second', description: 'Synthetic payment D'},
			],
			initial,
		);
		const previousKeys = new Set(initial.map(({stableIdentityKey}) => stableIdentityKey));

		expect(refreshed.every(({stableIdentityKey}) => !previousKeys.has(stableIdentityKey))).toBe(true);
		expect(new Set(refreshed.map(({stableIdentityKey}) => stableIdentityKey)).size).toBe(2);
	});

	it('allocates the next unused occurrence key within an identity group', () => {
		const firstKey = createBankTransactionStableIdentityKeyForGroup('synthetic-group', 1);
		const secondKey = createBankTransactionStableIdentityKeyForGroup('synthetic-group', 2);

		const allocation = allocateNextBankTransactionStableIdentityKey('synthetic-group', new Set([firstKey]));

		expect(allocation).toEqual({stableIdentityKey: secondKey, nextOccurrence: 3});
	});

	it('recognizes legacy SHA-256 dedupe keys', () => {
		expect(isLegacyBankTransactionDedupeKey('a'.repeat(64))).toBe(true);
		expect(isLegacyBankTransactionDedupeKey('123e4567-e89b-42d3-a456-426614174000')).toBe(false);
		expect(isLegacyBankTransactionDedupeKey(null)).toBe(false);
	});
});
