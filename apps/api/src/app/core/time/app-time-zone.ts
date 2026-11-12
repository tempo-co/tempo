/** The owner's time zone: "today" for sync windows, MCP defaults and alert quiet hours. */
export const APP_TIME_ZONE = 'Europe/Amsterdam';

const appDate = new Intl.DateTimeFormat('en-CA', {
	timeZone: APP_TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

/** The calendar date (`YYYY-MM-DD`) of `instant` in the app's time zone. */
export function dateInAppTimeZone(instant: Date): string {
	return appDate.format(instant);
}
