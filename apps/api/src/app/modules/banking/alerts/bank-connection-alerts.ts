import {BankConnection} from '../bank-connection.entity';
import {BANK_CONNECTION_STATUSES} from '../services/banking-sync.constants';

export const CONSENT_EXPIRING_ALERT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const CONSENT_FINAL_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SYNC_BROKEN_ALERT_AFTER_MS = 24 * 60 * 60 * 1000;

export const BANK_CONNECTION_ALERTS = {
	CONSENT_EXPIRING: 'CONSENT_EXPIRING',
	CONSENT_FINAL: 'CONSENT_FINAL',
	SYNC_BROKEN: 'SYNC_BROKEN',
} as const;

export type BankConnectionAlert = (typeof BANK_CONNECTION_ALERTS)[keyof typeof BANK_CONNECTION_ALERTS];

export type BankConnectionAlertState = Pick<
	BankConnection,
	'status' | 'consentValidUntil' | 'createdAt' | 'consentExpiringAlertFor' | 'consentFinalAlertFor' | 'syncAlertFor'
> & {lastSuccessfulSyncAt: Date | null};

/**
 * Markers hold the value they warned about: the consent end date, or the last successful sync (creation, for a
 * connection that never synced). A reauthorization or successful sync stores a new value and starts a new episode.
 */
export function getDueBankConnectionAlerts(connection: BankConnectionAlertState, now: Date): BankConnectionAlert[] {
	const alerts: BankConnectionAlert[] = [];
	const consentAlert = getDueConsentAlert(connection, now);
	if (consentAlert) alerts.push(consentAlert);
	if (isSyncAlertDue(connection, now)) alerts.push(BANK_CONNECTION_ALERTS.SYNC_BROKEN);
	return alerts;
}

function getDueConsentAlert(connection: BankConnectionAlertState, now: Date): BankConnectionAlert | null {
	const {consentValidUntil} = connection;
	if (connection.status !== BANK_CONNECTION_STATUSES.AUTHORIZED || !consentValidUntil) return null;

	const remainingMs = consentValidUntil.getTime() - now.getTime();
	if (remainingMs <= 0) return null;
	if (remainingMs <= CONSENT_FINAL_ALERT_WINDOW_MS) {
		return isSameTime(connection.consentFinalAlertFor, consentValidUntil)
			? null
			: BANK_CONNECTION_ALERTS.CONSENT_FINAL;
	}
	if (remainingMs <= CONSENT_EXPIRING_ALERT_WINDOW_MS) {
		return isSameTime(connection.consentExpiringAlertFor, consentValidUntil)
			? null
			: BANK_CONNECTION_ALERTS.CONSENT_EXPIRING;
	}
	return null;
}

function isSyncAlertDue(connection: BankConnectionAlertState, now: Date): boolean {
	if (
		connection.status !== BANK_CONNECTION_STATUSES.AUTHORIZED &&
		connection.status !== BANK_CONNECTION_STATUSES.EXPIRED
	) {
		return false;
	}
	const lastSuccess = connection.lastSuccessfulSyncAt ?? connection.createdAt;
	if (now.getTime() - lastSuccess.getTime() < SYNC_BROKEN_ALERT_AFTER_MS) return false;
	return !isSameTime(connection.syncAlertFor, lastSuccess);
}

function isSameTime(left: Date | null, right: Date): boolean {
	return left !== null && left.getTime() === right.getTime();
}
