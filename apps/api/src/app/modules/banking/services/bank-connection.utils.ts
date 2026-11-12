import {Logger, ServiceUnavailableException} from '@nestjs/common';

import {ConfigurationService} from '@core/config/config.service';

import {BANKING_SERVICE_UNAVAILABLE} from '../api/constants/banking-messages.constants';
import {BankingAuthorizationStateError} from '../errors/banking-authorization-state.error';
import {BankingEncryptionError} from '../errors/banking-encryption.error';
import {BankingConnectionLock} from './banking-connection-lock.service';
import {EnableBankingClientError} from './enable-banking.client';

export function isBankingIntegrationEnabled(configurationService: ConfigurationService): boolean {
	return configurationService.get?.('BANKING_INTEGRATION_ENABLED') !== false;
}

export function ensureBankingIntegrationEnabled(configurationService: ConfigurationService): void {
	if (!isBankingIntegrationEnabled(configurationService)) {
		throw new ServiceUnavailableException(BANKING_SERVICE_UNAVAILABLE);
	}
}

/** A log-safe code for an error: typed banking errors keep their code, anything else is `internal_error`. */
export function safeErrorCode(error: unknown): string {
	if (error instanceof EnableBankingClientError) return `provider_${toLogSafeCode(error.code)}`;
	if (error instanceof BankingAuthorizationStateError) return `authorization_state_${error.code}`;
	if (error instanceof BankingEncryptionError) return `encryption_${error.code}`;
	return 'internal_error';
}

/** Stops renewing and releases the lock; a release failure is logged, never thrown. */
export async function releaseLockSafely(lock: BankingConnectionLock, logger: Logger, warning: string): Promise<void> {
	lock.stop();
	try {
		await lock.release();
	} catch (error) {
		logger.warn(`${warning}: ${safeErrorCode(error)}`);
	}
}

function toLogSafeCode(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}
