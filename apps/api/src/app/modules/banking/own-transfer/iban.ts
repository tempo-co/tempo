import {createHash, timingSafeEqual} from 'node:crypto';

const IBAN_SHAPE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const SEPA_DESCRIPTION_IBAN = /^SEPA\b.*?\bIBAN:\s*([A-Z]{2}\d{2}[A-Z0-9]{11,30})\b/is;
const IBAN_CURRENCY_HASH_HEADER = JSON.stringify([
	['account', 'account_id', 'iban'],
	['account', 'currency'],
]);

export function isValidIban(value: string): boolean {
	if (!IBAN_SHAPE.test(value)) return false;

	const rearranged = value.slice(4) + value.slice(0, 4);
	let remainder = 0;
	for (const character of rearranged) {
		const digits = Number.parseInt(character, 36).toString();
		for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
	}
	return remainder === 1;
}

export function normalizeIban(value: string | null | undefined): string | null {
	const iban = value?.replace(/\s+/g, '').toUpperCase();
	return iban && isValidIban(iban) ? iban : null;
}

export function parseSepaDescriptionIban(description: string | null | undefined): string | null {
	const match = description?.trim().match(SEPA_DESCRIPTION_IBAN);
	return normalizeIban(match?.[1]);
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
	const [headerSegment, digestSegment, ...rest] = identificationHash.split('.');
	if (!headerSegment || !digestSegment || rest.length > 0) return false;

	try {
		const header = JSON.stringify(JSON.parse(Buffer.from(headerSegment, 'base64url').toString('utf8')));
		if (header !== IBAN_CURRENCY_HASH_HEADER) return false;
	} catch {
		return false;
	}

	const expectedDigest = Buffer.from(digestSegment, 'base64url');
	const candidateDigest = createHash('sha256').update(`[\n"${iban}",\n"${currency}"\n]`).digest();
	return expectedDigest.length === candidateDigest.length && timingSafeEqual(expectedDigest, candidateDigest);
}
