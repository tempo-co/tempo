import {ParseRefusal} from './parse-result';

/** Whether `YYYY-MM-DD` names a day that exists. */
export function isCalendarDate(date: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
	const time = Date.parse(`${date}T00:00:00Z`);
	return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === date;
}

/** The date when it exists, else a `parse_failed` refusal. */
export function checkedDate(date: string): string {
	if (!isCalendarDate(date)) throw new ParseRefusal('parse_failed');
	return date;
}
