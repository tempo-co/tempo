import {pushAlertDeliveryTime} from './push-alert-hours';

describe('pushAlertDeliveryTime', () => {
	it.each([
		['during the day, now', 'Europe/Amsterdam', '2026-06-10T12:00:00Z', '2026-06-10T12:00:00.000Z'],
		['at 09:00 sharp, now', 'Europe/Amsterdam', '2026-06-10T07:00:00Z', '2026-06-10T07:00:00.000Z'],
		['just before 21:00, now', 'Europe/Amsterdam', '2026-06-10T18:59:59Z', '2026-06-10T18:59:59.000Z'],
		['at 21:00, the next morning', 'Europe/Amsterdam', '2026-06-10T19:00:00Z', '2026-06-11T07:00:00.000Z'],
		['after midnight, the same morning', 'Europe/Amsterdam', '2026-06-10T23:30:00Z', '2026-06-11T07:00:00.000Z'],
		['in winter, at 09:00 winter time', 'Europe/Amsterdam', '2026-01-15T22:00:00Z', '2026-01-16T08:00:00.000Z'],
		[
			'on the night summer time starts, at 09:00 summer time',
			'Europe/Amsterdam',
			'2026-03-28T21:00:00Z',
			'2026-03-29T07:00:00.000Z',
		],
		[
			'on the night summer time ends, at 09:00 winter time',
			'Europe/Amsterdam',
			'2026-10-24T20:00:00Z',
			'2026-10-25T08:00:00.000Z',
		],
		['at 20:30 in Lisbon, now', 'Europe/Lisbon', '2026-01-15T20:30:00Z', '2026-01-15T20:30:00.000Z'],
		[
			'at 22:30 in Helsinki, at 09:00 Helsinki',
			'Europe/Helsinki',
			'2026-01-15T20:30:00Z',
			'2026-01-16T07:00:00.000Z',
		],
		[
			'at 21:00 in New York, at 09:00 there',
			'America/New_York',
			'2026-01-16T02:00:00Z',
			'2026-01-16T14:00:00.000Z',
		],
		['at 08:59 in UTC, at 09:00 UTC', 'UTC', '2026-01-15T08:59:00Z', '2026-01-15T09:00:00.000Z'],
	])('delivers an alert raised %s', (_case, timeZone, raised, delivered) => {
		expect(pushAlertDeliveryTime(new Date(raised), timeZone).toISOString()).toBe(delivered);
	});
});
