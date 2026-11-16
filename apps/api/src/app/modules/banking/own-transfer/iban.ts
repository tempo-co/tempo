import {createHash, timingSafeEqual} from 'node:crypto';

const IBAN_SHAPE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const SEPA_DESCRIPTION_IBAN = /^SEPA\b.*?\bIBAN:\s*([A-Z]{2}\d{2}[A-Z0-9]{11,30})\b/is;
const IBAN_CURRENCY_HASH_HEADER = JSON.stringify([
	['account', 'account_id', 'iban'],
	['account', 'currency'],
]);

export function isValidIban(value: string): boolean {
	if (!IBAN_SHAPE.test(value)) return false;
	return ibanRemainder(value.slice(4) + value.slice(0, 4)) === 1;
}

/** ISO 13616's check: letters as their base-36 values (A = 10), the resulting number modulo 97. */
export function ibanRemainder(characters: string): number {
	let remainder = 0;
	for (const character of characters) {
		const digits = Number.parseInt(character, 36).toString();
		for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
	}
	return remainder;
}

export function normalizeIban(value: string | null | undefined): string | null {
	const iban = value?.replace(/\s+/g, '').toUpperCase();
	return iban && isValidIban(iban) ? iban : null;
}

export function parseSepaDescriptionIban(description: string | null | undefined): string | null {
	const match = description?.trim().match(SEPA_DESCRIPTION_IBAN);
	return normalizeIban(match?.[1]);
}

/** Whether an identification hash has the IBAN-and-currency shape `verifyIbanAgainstIdentificationHash` checks. */
export function isIbanIdentificationHash(identificationHash: string): boolean {
	const [headerSegment, digestSegment, ...rest] = identificationHash.split('.');
	if (!headerSegment || !digestSegment || rest.length > 0) return false;
	try {
		const header = JSON.stringify(JSON.parse(Buffer.from(headerSegment, 'base64url').toString('utf8')));
		return header === IBAN_CURRENCY_HASH_HEADER;
	} catch {
		return false;
	}
}

/**
 * Checks a candidate IBAN against Enable Banking's account identification hash. The hash format is
 * observed rather than documented, so any unexpected shape fails closed.
 */
export function verifyIbanAgainstIdentificationHash(
	identificationHash: string,
	iban: string,
	currency: string,
): boolean {
	if (!isIbanIdentificationHash(identificationHash)) return false;
	const expectedDigest = Buffer.from(identificationHash.split('.')[1], 'base64url');
	const candidateDigest = createHash('sha256').update(`[\n"${iban}",\n"${currency}"\n]`).digest();
	return expectedDigest.length === candidateDigest.length && timingSafeEqual(expectedDigest, candidateDigest);
}
