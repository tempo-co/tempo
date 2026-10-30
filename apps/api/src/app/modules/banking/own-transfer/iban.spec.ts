import {createHash} from 'node:crypto';

import {isValidIban, normalizeIban, parseSepaDescriptionIban, verifyIbanAgainstIdentificationHash} from './iban';

// Published example IBANs (ISO 13616 / bank documentation), not real accounts.
const EXAMPLE_NL_IBAN = 'NL91ABNA0417164300';
const EXAMPLE_GB_IBAN = 'GB82WEST12345698765432';
const EXAMPLE_DE_IBAN = 'DE89370400440532013000';

function toBase64Url(value: Buffer | string): string {
	return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createIdentificationHash(iban: string, currency: string, header: unknown = IBAN_CURRENCY_HEADER): string {
	const digest = createHash('sha256').update(`[\n"${iban}",\n"${currency}"\n]`).digest();
	return `${toBase64Url(JSON.stringify(header))}.${toBase64Url(digest)}`;
}

const IBAN_CURRENCY_HEADER = [
	['account', 'account_id', 'iban'],
	['account', 'currency'],
];

describe('normalizeIban', () => {
	it.each([
		{input: 'nl91 abna 0417 1643 00', expected: EXAMPLE_NL_IBAN},
		{input: ` ${EXAMPLE_GB_IBAN} `, expected: EXAMPLE_GB_IBAN},
		{input: 'NL91ABNA0417164301', expected: null},
		{input: 'not an iban', expected: null},
		{input: '', expected: null},
		{input: null, expected: null},
		{input: undefined, expected: null},
	])('normalizes $input', ({input, expected}) => {
		expect(normalizeIban(input)).toBe(expected);
	});
});

describe('isValidIban', () => {
	it.each([EXAMPLE_NL_IBAN, EXAMPLE_GB_IBAN, EXAMPLE_DE_IBAN])('accepts %s', (iban) => {
		expect(isValidIban(iban)).toBe(true);
	});

	it.each(['NL91ABNA0417164301', 'GB82WEST12345698765433', 'NL91', '1234ABNA0417164300', 'NL91ABNA04171643!0'])(
		'rejects %s',
		(iban) => {
			expect(isValidIban(iban)).toBe(false);
		},
	);
});

describe('parseSepaDescriptionIban', () => {
	it('reads the counterparty IBAN from a SEPA description', () => {
		expect(
			parseSepaDescriptionIban(
				`SEPA Overboeking IBAN: ${EXAMPLE_GB_IBAN} BIC: TESTGB2L Naam: Example Person Omschrijving: savings`,
			),
		).toBe(EXAMPLE_GB_IBAN);
	});

	it('reads a SEPA direct debit IBAN regardless of case and spacing', () => {
		expect(
			parseSepaDescriptionIban(
				`sepa  incasso algemeen doorlopend Incassant: NL00TEST0000000000 Naam: Example Utility\nMachtiging: X IBAN: ${EXAMPLE_DE_IBAN} Kenmerk: 1`,
			),
		).toBe(EXAMPLE_DE_IBAN);
	});

	it.each([
		{name: 'non-SEPA text', description: `Transfer to IBAN: ${EXAMPLE_GB_IBAN}`},
		{name: 'an invalid checksum', description: 'SEPA Overboeking IBAN: NL91ABNA0417164301 Naam: Example Person'},
		{name: 'no IBAN field', description: 'SEPA Overboeking Naam: Example Person'},
		{name: 'an empty description', description: null},
	])('returns null for $name', ({description}) => {
		expect(parseSepaDescriptionIban(description)).toBeNull();
	});
});

describe('verifyIbanAgainstIdentificationHash', () => {
	it('matches the IBAN and currency used to build the hash', () => {
		const hash = createIdentificationHash(EXAMPLE_NL_IBAN, 'EUR');

		expect(verifyIbanAgainstIdentificationHash(hash, EXAMPLE_NL_IBAN, 'EUR')).toBe(true);
	});

	it('accepts padded standard base64 segments', () => {
		const hash = createIdentificationHash(EXAMPLE_NL_IBAN, 'EUR')
			.split('.')
			.map(
				(segment) => segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (segment.length % 4)) % 4),
			)
			.join('.');

		expect(verifyIbanAgainstIdentificationHash(hash, EXAMPLE_NL_IBAN, 'EUR')).toBe(true);
	});

	it.each([
		{name: 'a different currency', iban: EXAMPLE_NL_IBAN, currency: 'GBP'},
		{name: 'a different IBAN', iban: EXAMPLE_GB_IBAN, currency: 'EUR'},
	])('rejects $name', ({iban, currency}) => {
		const hash = createIdentificationHash(EXAMPLE_NL_IBAN, 'EUR');

		expect(verifyIbanAgainstIdentificationHash(hash, iban, currency)).toBe(false);
	});

	it.each([
		{name: 'an unknown header', hash: createIdentificationHash(EXAMPLE_NL_IBAN, 'EUR', [['account', 'other']])},
		{name: 'a hash without a separator', hash: 'not-a-hash'},
		{name: 'a header that is not JSON', hash: `${toBase64Url('{')}.${toBase64Url('x')}`},
		{name: 'an empty hash', hash: ''},
	])('fails safe for $name', ({hash}) => {
		expect(verifyIbanAgainstIdentificationHash(hash, EXAMPLE_NL_IBAN, 'EUR')).toBe(false);
	});
});
