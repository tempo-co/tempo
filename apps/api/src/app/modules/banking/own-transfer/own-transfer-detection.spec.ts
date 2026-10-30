import {
	OWN_TRANSFER_EVIDENCE,
	OWN_TRANSFER_OVERRIDES,
	OwnTransferAccount,
	OwnTransferTransaction,
	detectOwnTransfers,
	resolveOwnTransferCounterpartyName,
} from './own-transfer-detection';

// Published example IBANs, not real accounts.
const BANK_IBAN = 'NL91ABNA0417164300';
const WALLET_IBAN = 'GB82WEST12345698765432';
const STRANGER_IBAN = 'DE89370400440532013000';

const BANK_EUR = 'aaaaaaaa-0000-4000-8000-000000000001';
const WALLET_EUR = 'aaaaaaaa-0000-4000-8000-000000000002';
const WALLET_GBP = 'aaaaaaaa-0000-4000-8000-000000000003';
const OTHER_GBP = 'aaaaaaaa-0000-4000-8000-000000000004';

const accounts: OwnTransferAccount[] = [
	{id: BANK_EUR, aspspName: 'Example Bank', currency: 'EUR', iban: BANK_IBAN, holderName: 'J M EXAMPLE'},
	{id: WALLET_EUR, aspspName: 'Revolut', currency: 'EUR', iban: WALLET_IBAN, holderName: 'Jane-Marie Example'},
	{id: WALLET_GBP, aspspName: 'Revolut', currency: 'GBP', iban: WALLET_IBAN, holderName: 'Jane-Marie Example'},
	{id: OTHER_GBP, aspspName: 'Revolut', currency: 'GBP', iban: null, holderName: 'Jane-Marie Example'},
];

let sequence = 0;
function tx(overrides: Partial<OwnTransferTransaction> & Pick<OwnTransferTransaction, 'bankAccountId' | 'amount'>) {
	sequence += 1;
	return {
		id: `bbbbbbbb-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
		currency: 'EUR',
		date: '2026-01-10',
		transactionStatus: 'BOOK',
		transactionType: 'TRANSFER',
		financialEventType: null,
		counterpartyIban: null,
		description: null,
		override: null,
		...overrides,
	} satisfies OwnTransferTransaction;
}

/** An ABN AMRO-style SEPA description carrying the other party's name. */
function sepa(name: string): string {
	return `SEPA Overboeking IBAN: ${STRANGER_IBAN} BIC: TESTDEFF Naam: ${name} Omschrijving: x`;
}

function detect(transactions: OwnTransferTransaction[]) {
	return Object.fromEntries(detectOwnTransfers({accounts, transactions}));
}

describe('resolveOwnTransferCounterpartyName', () => {
	it.each([
		{
			name: 'the SEPA name field',
			input: {
				description: `SEPA Overboeking IBAN: ${WALLET_IBAN} BIC: TESTGB2L Naam: J M Example Omschrijving: savings`,
				aspspName: 'Example Bank',
			},
			expected: 'J M Example',
		},
		{
			name: 'a Revolut outgoing transfer',
			input: {description: 'To  Jane-Marie Example', aspspName: 'Revolut'},
			expected: 'Jane-Marie Example',
		},
		{
			name: 'a Revolut incoming transfer',
			input: {description: 'Payment from Jane-Marie Example', aspspName: 'revolut'},
			expected: 'Jane-Marie Example',
		},
		{
			name: 'nothing for the transfer wording at another bank',
			input: {description: 'To Jane-Marie Example', aspspName: 'Example Bank'},
			expected: null,
		},
	])('uses $name', ({input, expected}) => {
		expect(resolveOwnTransferCounterpartyName(input)).toBe(expected);
	});
});

describe('detectOwnTransfers', () => {
	it('pairs an IBAN-anchored leg with an evidence-less leg in the target account', () => {
		const outgoing = tx({bankAccountId: BANK_EUR, amount: '-250.00', counterpartyIban: WALLET_IBAN});
		const incoming = tx({bankAccountId: WALLET_EUR, amount: '250.00000000', date: '2026-01-13'});

		expect(detect([outgoing, incoming])).toEqual({
			[outgoing.id]: {evidence: OWN_TRANSFER_EVIDENCE.IBAN, counterpartId: incoming.id},
			[incoming.id]: {evidence: OWN_TRANSFER_EVIDENCE.IBAN, counterpartId: outgoing.id},
		});
	});

	it('pairs two name-evidence legs across connections', () => {
		const outgoing = tx({bankAccountId: WALLET_EUR, amount: '-40', description: 'To Jane-Marie Example'});
		const incoming = tx({
			bankAccountId: BANK_EUR,
			amount: '40.00',
			date: '2026-01-11',
			description:
				'SEPA Overboeking IBAN: GB33BUKB20201555555555 BIC: X Naam: Jane-Marie Example Omschrijving: x',
		});

		expect(detect([outgoing, incoming])).toEqual({
			[outgoing.id]: {evidence: OWN_TRANSFER_EVIDENCE.NAME, counterpartId: incoming.id},
			[incoming.id]: {evidence: OWN_TRANSFER_EVIDENCE.NAME, counterpartId: outgoing.id},
		});
	});

	it('does not pair a name leg with an evidence-less leg that only matches amount and date', () => {
		const named = tx({bankAccountId: WALLET_EUR, amount: '-12.50', description: 'To Jane-Marie Example'});
		const coincidence = tx({bankAccountId: BANK_EUR, amount: '12.50', description: sepa('Example Employer')});

		expect(detect([named, coincidence])).toEqual({
			[named.id]: {evidence: OWN_TRANSFER_EVIDENCE.NAME, counterpartId: null},
		});
	});

	it('ignores card payments that carry the holder name', () => {
		const card = tx({
			bankAccountId: WALLET_EUR,
			amount: '-30',
			transactionType: 'CARD_PAYMENT',
			description: 'To Jane-Marie Example',
		});
		const incoming = tx({bankAccountId: BANK_EUR, amount: '30', description: sepa('Jane-Marie Example')});

		expect(detect([card, incoming])).toEqual({
			[incoming.id]: {evidence: OWN_TRANSFER_EVIDENCE.NAME, counterpartId: null},
		});
	});

	it('ignores the provider counterparty name, which can be the holder themselves', () => {
		// When the bank omits the creditor, the provider repeats the debtor: the holder's own name.
		const fee = tx({
			bankAccountId: BANK_EUR,
			amount: '-4.50',
			transactionType: 'OTHER',
			description: 'Account fee',
		});

		expect(detect([{...fee, counterpartyName: 'J M EXAMPLE'} as OwnTransferTransaction])).toEqual({});
	});

	it.each([
		{name: 'a relative with the same surname', counterpartyName: 'John Example', expected: false},
		{name: 'the first given name and surname', counterpartyName: 'JANE EXAMPLE', expected: true},
		{name: 'the bank-reported initials', counterpartyName: 'J.M. Example', expected: true},
		{name: 'the initials after a salutation', counterpartyName: 'MW J M Example', expected: true},
		{name: 'an initial standing for a fuller name', counterpartyName: 'J Example', expected: false},
		{name: 'a relative sharing the first initial', counterpartyName: 'J P Example', expected: false},
		{name: 'the first given name with accents', counterpartyName: 'Jáne Exämple', expected: true},
		{
			name: 'the full hyphenated name with extra spacing',
			counterpartyName: ' jane-marie   example ',
			expected: true,
		},
		{name: 'a single token', counterpartyName: 'Example', expected: false},
	])('matching $name is $expected', ({counterpartyName, expected}) => {
		const leg = tx({bankAccountId: BANK_EUR, amount: '-10', description: sepa(counterpartyName)});

		expect(Boolean(detect([leg])[leg.id])).toBe(expected);
	});

	it('keeps an accented holder name whole', () => {
		const holder: OwnTransferAccount = {...accounts[0], holderName: 'Jürgen Müller'};
		const leg = tx({bankAccountId: BANK_EUR, amount: '-10', description: sepa('JURGEN MULLER')});
		const relative = tx({bankAccountId: BANK_EUR, amount: '-11', description: sepa('J LLER')});

		expect(
			Object.keys(Object.fromEntries(detectOwnTransfers({accounts: [holder], transactions: [leg, relative]}))),
		).toEqual([leg.id]);
	});

	it.each([
		{name: 'pending legs', overrides: {transactionStatus: 'PDNG'}},
		{name: 'currency-exchange legs', overrides: {financialEventType: 'CURRENCY_EXCHANGE'}},
	])('excludes $name', ({overrides}) => {
		const outgoing = tx({bankAccountId: BANK_EUR, amount: '-75', counterpartyIban: WALLET_IBAN, ...overrides});
		const incoming = tx({bankAccountId: WALLET_EUR, amount: '75'});

		expect(detect([outgoing, incoming])).toEqual({});
	});

	it('never pairs legs within the same account', () => {
		const first = tx({bankAccountId: WALLET_EUR, amount: '-20', description: 'To Jane-Marie Example'});
		const second = tx({bankAccountId: WALLET_EUR, amount: '20', description: 'Payment from Jane-Marie Example'});

		expect(detect([first, second])).toEqual({
			[first.id]: {evidence: OWN_TRANSFER_EVIDENCE.NAME, counterpartId: null},
			[second.id]: {evidence: OWN_TRANSFER_EVIDENCE.NAME, counterpartId: null},
		});
	});

	it('does not count an IBAN pointing at the same account as evidence', () => {
		const leg = tx({bankAccountId: WALLET_EUR, amount: '-20', counterpartyIban: WALLET_IBAN});

		expect(detect([leg])).toEqual({});
	});

	it('does not count an IBAN owned in another currency as evidence', () => {
		const leg = tx({bankAccountId: BANK_EUR, amount: '-20', currency: 'USD', counterpartyIban: WALLET_IBAN});
		const other = tx({bankAccountId: WALLET_EUR, amount: '20', currency: 'USD'});

		expect(detect([leg, other])).toEqual({});
	});

	it.each([
		{name: 'a five-day gap pairs', date: '2026-01-15', paired: true},
		{name: 'a six-day gap does not pair', date: '2026-01-16', paired: false},
		{name: 'a different amount does not pair', date: '2026-01-10', amount: '99.99', paired: false},
		{name: 'the same sign does not pair', date: '2026-01-10', amount: '-100', paired: false},
	])('$name', ({date, amount = '100', paired}) => {
		const outgoing = tx({bankAccountId: BANK_EUR, amount: '-100', counterpartyIban: WALLET_IBAN});
		const incoming = tx({bankAccountId: WALLET_EUR, amount, date});

		const result = detect([outgoing, incoming]);

		expect(result[outgoing.id]).toEqual({
			evidence: OWN_TRANSFER_EVIDENCE.IBAN,
			counterpartId: paired ? incoming.id : null,
		});
		expect(Boolean(result[incoming.id])).toBe(paired);
	});

	it('pairs an IBAN-anchored leg only with the account its IBAN names', () => {
		const outgoing = tx({bankAccountId: BANK_EUR, amount: '-100', counterpartyIban: WALLET_IBAN, currency: 'GBP'});
		const named = tx({
			bankAccountId: OTHER_GBP,
			amount: '100',
			currency: 'GBP',
			description: 'Payment from Jane-Marie Example',
		});
		const target = tx({bankAccountId: WALLET_GBP, amount: '100', currency: 'GBP', date: '2026-01-12'});

		expect(detect([outgoing, named, target])).toEqual({
			[outgoing.id]: {evidence: OWN_TRANSFER_EVIDENCE.IBAN, counterpartId: target.id},
			[target.id]: {evidence: OWN_TRANSFER_EVIDENCE.IBAN, counterpartId: outgoing.id},
			[named.id]: {evidence: OWN_TRANSFER_EVIDENCE.NAME, counterpartId: null},
		});
	});

	it('pairs identical same-day transfers one to one, nearest date first', () => {
		const outgoing = [1, 2, 3, 4].map(() =>
			tx({bankAccountId: BANK_EUR, amount: '-50', counterpartyIban: WALLET_IBAN, date: '2026-02-01'}),
		);
		const incoming = [1, 2, 3, 4].map(() => tx({bankAccountId: WALLET_EUR, amount: '50', date: '2026-02-01'}));
		const lateIncoming = tx({bankAccountId: WALLET_EUR, amount: '50', date: '2026-02-03'});

		const result = detect([...outgoing, lateIncoming, ...incoming]);

		const counterparts = outgoing.map((leg) => result[leg.id]?.counterpartId);
		expect(new Set(counterparts)).toEqual(new Set(incoming.map((leg) => leg.id)));
		for (const leg of incoming) {
			expect(outgoing.map((out) => out.id)).toContain(result[leg.id]?.counterpartId);
		}
		expect(result[lateIncoming.id]).toBeUndefined();
	});

	it('keeps unmatched evidence legs one-sided', () => {
		const ibanLeg = tx({bankAccountId: BANK_EUR, amount: '-500', counterpartyIban: WALLET_IBAN});
		const nameLeg = tx({
			bankAccountId: WALLET_GBP,
			amount: '250',
			currency: 'GBP',
			description: 'Payment from Jane Example',
		});
		const stranger = tx({bankAccountId: BANK_EUR, amount: '-60', counterpartyIban: STRANGER_IBAN});

		expect(detect([ibanLeg, nameLeg, stranger])).toEqual({
			[ibanLeg.id]: {evidence: OWN_TRANSFER_EVIDENCE.IBAN, counterpartId: null},
			[nameLeg.id]: {evidence: OWN_TRANSFER_EVIDENCE.NAME, counterpartId: null},
		});
	});

	it('lets a manual mark make a leg one-sided or pair it with another evidence leg', () => {
		const marked = tx({bankAccountId: BANK_EUR, amount: '-80', override: OWN_TRANSFER_OVERRIDES.MARKED});
		const markedTwin = tx({bankAccountId: WALLET_EUR, amount: '80', override: OWN_TRANSFER_OVERRIDES.MARKED});
		const markedAlone = tx({
			bankAccountId: WALLET_EUR,
			amount: '-9',
			transactionType: 'CARD_PAYMENT',
			override: OWN_TRANSFER_OVERRIDES.MARKED,
		});

		expect(detect([marked, markedTwin, markedAlone])).toEqual({
			[marked.id]: {evidence: OWN_TRANSFER_EVIDENCE.MANUAL, counterpartId: markedTwin.id},
			[markedTwin.id]: {evidence: OWN_TRANSFER_EVIDENCE.MANUAL, counterpartId: marked.id},
			[markedAlone.id]: {evidence: OWN_TRANSFER_EVIDENCE.MANUAL, counterpartId: null},
		});
	});

	it('keeps automatic evidence on a leg that was also marked manually', () => {
		const outgoing = tx({
			bankAccountId: BANK_EUR,
			amount: '-15',
			counterpartyIban: WALLET_IBAN,
			override: OWN_TRANSFER_OVERRIDES.MARKED,
		});

		expect(detect([outgoing])).toEqual({
			[outgoing.id]: {evidence: OWN_TRANSFER_EVIDENCE.IBAN, counterpartId: null},
		});
	});

	it('uses the IBAN as pair evidence when it targets the other leg, even if the other leg was marked', () => {
		const outgoing = tx({bankAccountId: BANK_EUR, amount: '-33', counterpartyIban: WALLET_IBAN});
		const incoming = tx({bankAccountId: WALLET_EUR, amount: '33', override: OWN_TRANSFER_OVERRIDES.MARKED});

		expect(detect([outgoing, incoming])).toEqual({
			[outgoing.id]: {evidence: OWN_TRANSFER_EVIDENCE.IBAN, counterpartId: incoming.id},
			[incoming.id]: {evidence: OWN_TRANSFER_EVIDENCE.IBAN, counterpartId: outgoing.id},
		});
	});

	it('lets an unmark remove a leg and frees its counterpart', () => {
		const outgoing = tx({
			bankAccountId: BANK_EUR,
			amount: '-45',
			counterpartyIban: WALLET_IBAN,
			override: OWN_TRANSFER_OVERRIDES.UNMARKED,
		});
		const incoming = tx({bankAccountId: WALLET_EUR, amount: '45', description: 'Payment from Jane-Marie Example'});

		expect(detect([outgoing, incoming])).toEqual({
			[incoming.id]: {evidence: OWN_TRANSFER_EVIDENCE.NAME, counterpartId: null},
		});
	});

	it('never pairs zero amounts', () => {
		const outgoing = tx({bankAccountId: BANK_EUR, amount: '0.00', counterpartyIban: WALLET_IBAN});
		const incoming = tx({bankAccountId: WALLET_EUR, amount: '-0', description: 'Payment from Jane-Marie Example'});

		expect(detect([outgoing, incoming])).toEqual({
			[outgoing.id]: {evidence: OWN_TRANSFER_EVIDENCE.IBAN, counterpartId: null},
			[incoming.id]: {evidence: OWN_TRANSFER_EVIDENCE.NAME, counterpartId: null},
		});
	});

	it('returns the same result regardless of input order', () => {
		const ibanOut = [1, 2, 3].map((day) =>
			tx({bankAccountId: BANK_EUR, amount: '-10', counterpartyIban: WALLET_IBAN, date: `2026-03-0${day}`}),
		);
		const plainIn = [1, 2, 3, 4].map((day) =>
			tx({bankAccountId: WALLET_EUR, amount: '10', date: `2026-03-0${day}`}),
		);
		const nameOut = tx({
			bankAccountId: WALLET_EUR,
			amount: '-10',
			description: 'To Jane-Marie Example',
			date: '2026-03-02',
		});
		const nameIn = tx({
			bankAccountId: BANK_EUR,
			amount: '10',
			description: sepa('J M Example'),
			date: '2026-03-04',
		});
		const transactions = [...ibanOut, ...plainIn, nameOut, nameIn];
		const expected = detect(transactions);

		for (const shuffled of [[...transactions].reverse(), rotate(transactions, 3), rotate(transactions, 5)]) {
			expect(detect(shuffled)).toEqual(expected);
		}
		ibanOut.forEach((leg, index) => expect(expected[leg.id]?.counterpartId).toBe(plainIn[index].id));
		expect(expected[nameOut.id]).toEqual({evidence: OWN_TRANSFER_EVIDENCE.NAME, counterpartId: nameIn.id});
		expect(expected[plainIn[3].id]).toBeUndefined();
	});
});

function rotate<T>(items: T[], by: number): T[] {
	return [...items.slice(by), ...items.slice(0, by)];
}
