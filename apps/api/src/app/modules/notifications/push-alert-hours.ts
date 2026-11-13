/** Alerts follow the owner's time zone: none arrive between 21:00 and 09:00 there. */
const QUIET_FROM_HOUR = 21;
const QUIET_UNTIL_HOUR = 9;

const wallClocks = new Map<string, Intl.DateTimeFormat>();

type WallTime = {year: number; month: number; day: number; hour: number; minute: number; second: number};

function wallTime(instant: Date, timeZone: string): WallTime {
	let wallClock = wallClocks.get(timeZone);
	if (!wallClock) {
		wallClock = new Intl.DateTimeFormat('en-GB', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		});
		wallClocks.set(timeZone, wallClock);
	}
	const parts = Object.fromEntries(
		wallClock.formatToParts(instant).map(({type, value}) => [type, Number(value)]),
	) as Record<keyof WallTime, number>;
	return parts;
}

/** Milliseconds the time zone is ahead of UTC at `instant`. */
function offsetAt(instant: Date, timeZone: string): number {
	const {year, month, day, hour, minute, second} = wallTime(instant, timeZone);
	return Date.UTC(year, month - 1, day, hour, minute, second) - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * When an alert raised at `now` may arrive for an owner in `timeZone` (an IANA name): `now`, or 09:00 there when it
 * is raised between 21:00 and 09:00 there.
 */
export function pushAlertDeliveryTime(now: Date, timeZone: string): Date {
	const {year, month, day, hour} = wallTime(now, timeZone);
	if (hour >= QUIET_UNTIL_HOUR && hour < QUIET_FROM_HOUR) return now;
	const morning = Date.UTC(year, month - 1, hour >= QUIET_FROM_HOUR ? day + 1 : day, QUIET_UNTIL_HOUR);
	// The offset can change overnight (daylight saving time starts and ends at night), so take it at the morning.
	const estimate = new Date(morning - offsetAt(now, timeZone));
	return new Date(morning - offsetAt(estimate, timeZone));
}
