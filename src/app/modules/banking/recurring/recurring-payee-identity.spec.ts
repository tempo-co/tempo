import {getBankTransactionMerchantKey} from '../categorization/bank-transaction-merchant-key';
import {type RecurringEvidence, inferRecurringIdentities} from './recurring-payee-identity';

let nextId = 0;

function row(overrides: Partial<RecurringEvidence> = {}): RecurringEvidence {
	const base = {
		id: `row-${++nextId}`,
		bankAccountId: 'account-1',
		date: '2026-01-05',
		currency: 'EUR',
		amountCents: 2400n,
		baseAmountCents: 2400n,
		counterpartyName: 'Example Service' as string | null,
		description: null as string | null,
		transactionType: 'OTHER' as string | null,
		category: 'SUBSCRIPTIONS' as string | null,
		...overrides,
	};
	const indicator = overrides.merchantKey?.startsWith('INCOME:') ? 'CRDT' : 'DBIT';
	return {
		...base,
		merchantKey:
			overrides.merchantKey ?? getBankTransactionMerchantKey({...base, creditDebitIndicator: indicator})!,
		name: base.counterpartyName ?? base.description ?? 'Transaction',
	};
}

/** A SEPA debit naming the payee in its structured record, with a shared creditor and mandate. */
function sepaDebit(name: string, overrides: Partial<RecurringEvidence> = {}): RecurringEvidence {
	return row({
		counterpartyName: name,
		description: `SEPA Incasso Incassant: EXAMPLECREDITOR Naam: ${name} Machtiging: EXAMPLEMANDATE IBAN: NL91ABNA0417164300 Omschrijving: Example billing`,
		...overrides,
	});
}

function card(merchant: string): RecurringEvidence {
	return row({
		counterpartyName: 'Example Acquirer',
		description: `BEA, ${merchant},PAS123 NR:123`,
		transactionType: 'CARD_PAYMENT',
	});
}

function identity(rows: RecurringEvidence[]): (string | undefined)[] {
	return inferRecurringIdentities(rows).map(({recurringPayeeKey}) => recurringPayeeKey);
}

describe('inferRecurringIdentities', () => {
	it.each<[string, () => RecurringEvidence[]]>([
		[
			'a transfer description and the later counterparty name',
			() => [
				row({
					counterpartyName: null,
					description: 'To Exámple School',
					transactionType: 'TRANSFER',
					category: 'EDUCATION',
				}),
				row({counterpartyName: 'EXAMPLE SCHOOL', category: 'EDUCATION'}),
			],
		],
		[
			'a counterparty and the structured SEPA name of another row',
			() => [
				row({
					counterpartyName: 'Example Former Entity',
					description: 'SEPA Overboeking Naam: Example Current Entity IBAN: NL91ABNA0417164300',
				}),
				row({counterpartyName: 'Example Current Entity'}),
			],
		],
		[
			'structured company names written with different spacing',
			() => [sepaDebit('Example Music AB'), sepaDebit('EXAMPLEMUSICAB')],
		],
		[
			'structured company names on transfers without a mandate',
			() =>
				['Example Society AB', 'EXAMPLESOCIETYAB'].map((name) =>
					row({
						counterpartyName: name,
						description: `SEPA Overboeking Naam: ${name} IBAN: NL91ABNA0417164300`,
						transactionType: 'TRANSFER',
					}),
				),
		],
	])('links one payee across %s', (_label, rows) => {
		const [first, second] = identity(rows());
		expect(first).toMatch(/^EXPENSE:automatic-recurring:[0-9a-f]{64}$/);
		expect(second).toBe(first);
	});

	it.each<[string, () => RecurringEvidence[]]>([
		[
			'a shared collection IBAN',
			() => [
				sepaDebit('Example Books', {counterpartyIban: 'NL91ABNA0417164300'} as Partial<RecurringEvidence>),
				sepaDebit('Example Shoes', {counterpartyIban: 'NL91ABNA0417164300'} as Partial<RecurringEvidence>),
			],
		],
		['a shared creditor and mandate', () => [sepaDebit('Example Cinema'), sepaDebit('Example Pharmacy')]],
		[
			'a company-name prefix',
			() => [row({counterpartyName: 'Example Fit'}), row({counterpartyName: 'Example Fitness'})],
		],
		[
			'a location-looking suffix',
			() => [row({counterpartyName: 'Example Gym'}), row({counterpartyName: 'Example Gym Exampletown'})],
		],
		['one card acquirer for two printed merchants', () => [card('Example Books'), card('Example Shoes')]],
		[
			'card text beginning with "To"',
			() => [
				row({
					counterpartyName: null,
					description: 'BEA, To Example Shop,PAS123 NR:123',
					transactionType: 'CARD_PAYMENT',
				}),
				row({counterpartyName: 'Example Shop'}),
			],
		],
		[
			'an explicit counterparty that starts with "To"',
			() => [
				row({counterpartyName: 'To Example Shop', transactionType: 'TRANSFER'}),
				row({counterpartyName: 'Example Shop'}),
			],
		],
		[
			'an outgoing transfer worded as incoming',
			() => [
				row({counterpartyName: null, description: 'From Example School', transactionType: 'TRANSFER'}),
				row({counterpartyName: 'Example School'}),
			],
		],
		[
			'free text beginning with "To" on a payment that is not a transfer',
			() => [
				row({counterpartyName: null, description: 'To Example Shop', transactionType: 'OTHER'}),
				row({counterpartyName: 'Example Shop'}),
			],
		],
		[
			'person transfers named like a company with different spacing',
			() => [
				sepaDebit('Alex Example AB', {category: 'TRANSFER_OUT'}),
				sepaDebit('ALEXEXAMPLEAB', {category: 'TRANSFER_OUT'}),
			],
		],
		[
			'structured names with different spacing but no legal form',
			() => [sepaDebit('Example Bar Stool'), sepaDebit('Example Barstool')],
		],
		[
			'company-like free text without a structured record',
			() => [row({counterpartyName: 'Example Music AB'}), row({counterpartyName: 'EXAMPLEMUSICAB'})],
		],
		[
			'different payment purposes',
			() => [
				row({counterpartyName: 'Example School', category: 'EDUCATION'}),
				row({
					counterpartyName: null,
					description: 'To Example School',
					transactionType: 'TRANSFER',
					category: 'FOOD_AND_DRINK',
				}),
			],
		],
		[
			'a payee with mixed purposes',
			() => [
				row({counterpartyName: 'Example School', category: 'EDUCATION'}),
				row({counterpartyName: 'Example School', category: 'OTHER'}),
				row({
					counterpartyName: null,
					description: 'To Example School',
					transactionType: 'TRANSFER',
					category: 'EDUCATION',
				}),
			],
		],
		[
			'different currencies',
			() => [
				row({counterpartyName: 'Example Current Entity', currency: 'USD'}),
				row({
					counterpartyName: 'Example Former Entity',
					description: 'SEPA Overboeking Naam: Example Current Entity IBAN: NL91ABNA0417164300',
				}),
			],
		],
	])('keeps payees apart despite %s', (_label, rows) => {
		const keys = identity(rows());
		expect(new Set(keys.slice(-2)).size === 1 && keys.at(-1) !== undefined).toBe(false);
	});

	it('keeps opposite directions apart', () => {
		const keys = identity([
			row({counterpartyName: 'Example Club'}),
			row({counterpartyName: 'Example Club', merchantKey: 'INCOME:example club'}),
		]);
		expect(keys).toEqual([undefined, undefined]);
	});

	it('marks one merchant key paid from several bank accounts, and nothing else', () => {
		const keys = identity([
			row({bankAccountId: 'account-1'}),
			row({bankAccountId: 'account-2'}),
			row({counterpartyName: 'Example Single Account'}),
		]);
		expect(keys).toEqual(['EXPENSE:example service', 'EXPENSE:example service', undefined]);
	});

	it('reads only the rows it is given and leaves them unchanged', () => {
		const rows = [sepaDebit('Example Media AB'), sepaDebit('EXAMPLEMEDIAAB')];
		const copy = structuredClone(rows);
		const result = inferRecurringIdentities(rows);
		expect(rows).toEqual(copy);
		expect(result.every((entry) => !('description' in entry) && !('counterpartyName' in entry))).toBe(true);
		expect(
			identity([row({counterpartyName: 'Example Media AB'}), row({counterpartyName: 'EXAMPLEMEDIAAB'})]),
		).toEqual([undefined, undefined]);
	});
});
