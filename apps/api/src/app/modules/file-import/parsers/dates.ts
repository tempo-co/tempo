import {ParseRefusal} from './parse-result';

/** Whether `YYYY-MM-DD` names a day that exists. */
export function isCalendarDate(date: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
	const time = Date.parse(`${date}T00:00:00Z`);
	return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === date;
}

const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * The calendar date of a spreadsheet day serial (days since 1899-12-30, a fraction for the time of day), rounded to
 * the second first, with no time zone conversion; null for anything that is not a day from 1900 to 9999.
 */
export function serialDate(days: number): string | null {
	if (!Number.isFinite(days) || days < 1 || days > 2_958_465) return null;
	return new Date(SERIAL_EPOCH_MS + Math.round(days * 86_400) * 1000).toISOString().slice(0, 10);
}

/** The date when it exists, else a `parse_failed` refusal. */
export function checkedDate(date: string): string {
	if (!isCalendarDate(date)) throw new ParseRefusal('parse_failed');
	return date;
}
