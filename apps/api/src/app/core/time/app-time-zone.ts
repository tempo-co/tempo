/**
 * The default account time zone: accounts keep it until signup or Settings stores another. Sync windows also use it
 * for "today" (bank dates, where the fetch overlap makes the zone irrelevant).
 */
export const APP_TIME_ZONE = 'Europe/Amsterdam';

/** The names an account may store: the IANA time zones this runtime's `Intl` lists, plus `UTC`. */
const SUPPORTED_TIME_ZONES = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * The supported time zone `value` names, in this runtime's spelling (`europe/lisbon` gives `Europe/Lisbon`, an alias
 * its canonical name), or null when it names none.
 */
export function supportedTimeZone(value: unknown): string | null {
	if (typeof value !== 'string' || value.length === 0 || value.length > 64) return null;
	let resolved: string;
	try {
		resolved = new Intl.DateTimeFormat('en-US', {timeZone: value}).resolvedOptions().timeZone;
	} catch {
		return null;
	}
	return SUPPORTED_TIME_ZONES.has(resolved) ? resolved : null;
}

/** The calendar date (`YYYY-MM-DD`) of `instant` in `timeZone`. */
export function dateInTimeZone(instant: Date, timeZone: string): string {
	let format = dateFormats.get(timeZone);
	if (!format) {
		format = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'});
		dateFormats.set(timeZone, format);
	}
	return format.format(instant);
}

/** The calendar date (`YYYY-MM-DD`) of `instant` in the app's default time zone. */
export function dateInAppTimeZone(instant: Date): string {
	return dateInTimeZone(instant, APP_TIME_ZONE);
}
