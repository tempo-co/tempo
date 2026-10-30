import {truncate} from './banking.utils';

export type BankTransactionLocation = {
	city: string | null;
	region: string | null;
	country: string | null;
};

const MAX_LOCATION_PART_LENGTH = 100;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/g;

export function normalizeBankTransactionLocation(value: unknown): BankTransactionLocation | null {
	if (!isRecord(value)) return null;

	const city = normalizeLocationPart(value.city);
	const region = normalizeLocationPart(value.region);
	const country = normalizeCountry(value.country);
	if (!city && !region && !country) return null;

	return {city, region, country};
}

export function formatBankTransactionLocation(value: BankTransactionLocation | null | undefined): string | null {
	if (!value) return null;

	const parts = [value.city, value.region, value.country].filter((part): part is string => part !== null);
	return parts.length > 0 ? parts.join(' ') : null;
}

function normalizeLocationPart(value: unknown): string | null {
	if (typeof value !== 'string') return null;

	const normalized = value.replace(CONTROL_CHARACTER_PATTERN, ' ').replace(/\s+/g, ' ').trim();
	if (!normalized) return null;

	return truncate(normalized, MAX_LOCATION_PART_LENGTH)?.trim() || null;
}

function normalizeCountry(value: unknown): string | null {
	const country = normalizeLocationPart(value)?.toUpperCase();
	return country && /^[A-Z]{2}$/.test(country) ? country : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
