import {latestExpectedEcbRateDate, normalizeCurrency} from './bank-transaction-amount-conversion.utils';

describe('bank transaction amount conversion utils', () => {
	it.each([
		['Monday before publication', '2026-09-07T08:00:00.000Z', '2026-09-04'],
		['Monday after publication', '2026-09-07T15:00:00.000Z', '2026-09-07'],
		['summer time, after publication in Berlin only', '2026-09-04T14:30:00.000Z', '2026-09-04'],
		['Saturday', '2026-09-05T12:00:00.000Z', '2026-09-04'],
		['Sunday evening', '2026-09-06T21:00:00.000Z', '2026-09-04'],
		['already Saturday in Berlin', '2026-09-04T22:30:00.000Z', '2026-09-04'],
		['winter time, before publication in Berlin', '2026-12-08T14:30:00.000Z', '2026-12-07'],
		['winter time, after publication in Berlin', '2026-12-08T15:00:00.000Z', '2026-12-08'],
	])('expects the ECB rate of the latest published business day: %s', (_scenario, now, expected) => {
		expect(latestExpectedEcbRateDate(new Date(now))).toBe(expected);
	});

	it('normalizes only three-letter currency codes', () => {
		expect(normalizeCurrency(' gbp ')).toBe('GBP');
		expect(normalizeCurrency('EURO')).toBeNull();
		expect(normalizeCurrency(null)).toBeNull();
	});
});
