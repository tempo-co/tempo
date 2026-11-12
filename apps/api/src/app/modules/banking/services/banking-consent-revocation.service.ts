import {Injectable, Logger} from '@nestjs/common';

import type {BankConnection} from '../bank-connection.entity';
import {classifyProviderFailure} from '../bank-sync-failure';
import {BankingEncryptionError} from '../errors/banking-encryption.error';
import {BankingEncryptionService} from './banking-encryption.service';
import {EnableBankingClient, EnableBankingClientError} from './enable-banking.client';

/** Upper bound for revoking all of one removal's sessions, so a slow provider cannot hold up a deletion. */
export const CONSENT_REVOCATION_TIMEOUT_MS = 10_000;

@Injectable()
export class BankingConsentRevocationService {
	private readonly logger = new Logger(BankingConsentRevocationService.name);

	constructor(
		private readonly enableBankingClient: EnableBankingClient,
		private readonly encryptionService: BankingEncryptionService,
	) {}

	/**
	 * Deletes each connection's provider session, which closes the bank consent, in parallel and within
	 * CONSENT_REVOCATION_TIMEOUT_MS. Best-effort: a session the provider no longer has counts as revoked, and any
	 * other failure is logged by code only and never thrown, so the caller's local deletion goes ahead.
	 */
	async revokeSessions(connections: readonly Pick<BankConnection, 'providerSessionId'>[]): Promise<void> {
		const encryptedSessionIds = connections.flatMap(({providerSessionId}) =>
			providerSessionId ? [providerSessionId] : [],
		);
		if (!encryptedSessionIds.length) return;

		const signal = AbortSignal.timeout(CONSENT_REVOCATION_TIMEOUT_MS);
		await Promise.all(encryptedSessionIds.map((encrypted) => this.revokeSession(encrypted, signal)));
	}

	private async revokeSession(encryptedSessionId: string, signal: AbortSignal): Promise<void> {
		try {
			await this.enableBankingClient.deleteSession(this.encryptionService.decrypt(encryptedSessionId), signal);
		} catch (error) {
			if (this.isSessionGone(error)) return;
			this.logger.warn(`Bank consent revocation failed: ${this.describe(error)}`);
		}
	}

	private isSessionGone(error: unknown): boolean {
		return (
			error instanceof EnableBankingClientError &&
			(error.providerStatus === 404 || classifyProviderFailure(error) === 'session_ended')
		);
	}

	private describe(error: unknown): string {
		if (error instanceof EnableBankingClientError) {
			const code = `provider_${error.code.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)}`;
			return error.providerStatus === undefined ? code : `${code} (HTTP ${error.providerStatus})`;
		}
		if (error instanceof BankingEncryptionError) return `encryption_${error.code}`;
		return 'internal_error';
	}
}
