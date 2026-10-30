import {BankConnectionAlertState, getDueBankConnectionAlerts} from './bank-connection-alerts';

const NOW = new Date('2026-03-10T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

function state(overrides: Partial<BankConnectionAlertState> = {}): BankConnectionAlertState {
	return {
		status: 'AUTHORIZED',
		consentValidUntil: at(90 * DAY),
		lastSuccessfulSyncAt: at(-HOUR),
		createdAt: at(-30 * DAY),
		consentExpiringAlertFor: null,
		consentFinalAlertFor: null,
		syncAlertFor: null,
		...overrides,
	};
}

describe('getDueBankConnectionAlerts', () => {
	it.each([
		['a healthy connection', state(), []],
		['consent ending in 8 days', state({consentValidUntil: at(8 * DAY)}), []],
		['consent ending in 7 days', state({consentValidUntil: at(7 * DAY)}), ['CONSENT_EXPIRING']],
		['consent ending in 2 days', state({consentValidUntil: at(2 * DAY)}), ['CONSENT_EXPIRING']],
		[
			'consent ending in 2 days after its 7-day alert',
			state({consentValidUntil: at(2 * DAY), consentExpiringAlertFor: at(2 * DAY)}),
			[],
		],
		[
			'consent ending in 2 days after a 7-day alert for an earlier consent',
			state({consentValidUntil: at(2 * DAY), consentExpiringAlertFor: at(-170 * DAY)}),
			['CONSENT_EXPIRING'],
		],
		[
			'consent ending in 20 hours after its 7-day alert',
			state({consentValidUntil: at(20 * HOUR), consentExpiringAlertFor: at(20 * HOUR)}),
			['CONSENT_FINAL'],
		],
		['consent ending in 20 hours without any alert', state({consentValidUntil: at(20 * HOUR)}), ['CONSENT_FINAL']],
		[
			'consent ending in 20 hours after its final alert',
			state({
				consentValidUntil: at(20 * HOUR),
				consentExpiringAlertFor: at(20 * HOUR),
				consentFinalAlertFor: at(20 * HOUR),
			}),
			[],
		],
		['consent that already ended', state({consentValidUntil: at(-HOUR)}), []],
		['an authorized connection without a consent date', state({consentValidUntil: null}), []],
		[
			'an expired connection whose consent date is near',
			state({status: 'EXPIRED', consentValidUntil: at(2 * DAY)}),
			[],
		],
		['no successful sync for 23 hours', state({lastSuccessfulSyncAt: at(-23 * HOUR)}), []],
		['no successful sync for 24 hours', state({lastSuccessfulSyncAt: at(-DAY)}), ['SYNC_BROKEN']],
		[
			'no successful sync for 2 days after the alert for this episode',
			state({lastSuccessfulSyncAt: at(-2 * DAY), syncAlertFor: at(-2 * DAY)}),
			[],
		],
		[
			'no successful sync for 2 days after an alert for an earlier episode',
			state({lastSuccessfulSyncAt: at(-2 * DAY), syncAlertFor: at(-3 * DAY)}),
			['SYNC_BROKEN'],
		],
		[
			'a never-synced connection created 23 hours ago',
			state({lastSuccessfulSyncAt: null, createdAt: at(-23 * HOUR)}),
			[],
		],
		[
			'a never-synced connection created 25 hours ago',
			state({lastSuccessfulSyncAt: null, createdAt: at(-25 * HOUR)}),
			['SYNC_BROKEN'],
		],
		[
			'an expired connection not synced for 2 days',
			state({status: 'EXPIRED', consentValidUntil: at(-2 * DAY), lastSuccessfulSyncAt: at(-2 * DAY)}),
			['SYNC_BROKEN'],
		],
		[
			'consent ending soon and sync broken',
			state({consentValidUntil: at(3 * DAY), lastSuccessfulSyncAt: at(-2 * DAY)}),
			['CONSENT_EXPIRING', 'SYNC_BROKEN'],
		],
		['a cancelled connection', state({status: 'CANCELLED', lastSuccessfulSyncAt: at(-9 * DAY)}), []],
		['a failed authorization', state({status: 'FAILED', lastSuccessfulSyncAt: null, createdAt: at(-9 * DAY)}), []],
	])('for %s returns %j', (_name, connection, expected) => {
		expect(getDueBankConnectionAlerts(connection, NOW)).toEqual(expected);
	});
});
