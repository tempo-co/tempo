import {Logger} from '@nestjs/common';

import {BankingEncryptionError} from '../errors/banking-encryption.error';
import {BankingConsentRevocationService, CONSENT_REVOCATION_TIMEOUT_MS} from './banking-consent-revocation.service';
import {BankingEncryptionService} from './banking-encryption.service';
import {EnableBankingClient, EnableBankingClientError} from './enable-banking.client';

function buildService(deleteSession: EnableBankingClient['deleteSession']) {
	const encryptionService = {
		decrypt: jest.fn((value: string) => {
			if (value === 'unreadable') throw new BankingEncryptionError('invalid_ciphertext');
			return value.replace(/^encrypted:/, '');
		}),
	};
	const client = {deleteSession: jest.fn(deleteSession)};
	const service = new BankingConsentRevocationService(
		client as unknown as EnableBankingClient,
		encryptionService as unknown as BankingEncryptionService,
	);
	return {service, client};
}

describe('BankingConsentRevocationService', () => {
	let warn: jest.SpyInstance;

	beforeEach(() => {
		warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('treats a session the provider no longer has as revoked and logs other failures by code only', async () => {
		const failures: Record<string, Error> = {
			missing: new EnableBankingClientError('provider_request_failed', 404),
			closed: new EnableBankingClientError('CLOSED_SESSION', 422),
			expired: new EnableBankingClientError('EXPIRED_SESSION', 400),
			broken: new EnableBankingClientError('INTERNAL_ERROR', 500),
			offline: new EnableBankingClientError('provider_unreachable'),
		};
		const {service, client} = buildService(async (sessionId) => {
			if (failures[sessionId]) throw failures[sessionId];
		});

		await expect(
			service.revokeSessions([
				{providerSessionId: 'encrypted:revoked'},
				{providerSessionId: null},
				...Object.keys(failures).map((sessionId) => ({providerSessionId: `encrypted:${sessionId}`})),
				{providerSessionId: 'unreadable'},
			]),
		).resolves.toBeUndefined();

		expect(client.deleteSession.mock.calls.map(([sessionId]) => sessionId)).toEqual([
			'revoked',
			'missing',
			'closed',
			'expired',
			'broken',
			'offline',
		]);
		expect(warn.mock.calls.map(([message]) => message)).toEqual([
			'Bank consent revocation failed: encryption_invalid_ciphertext',
			'Bank consent revocation failed: provider_INTERNAL_ERROR (HTTP 500)',
			'Bank consent revocation failed: provider_provider_unreachable',
		]);
	});

	it('gives every revocation one shared deadline, so a hanging provider cannot block the deletion', async () => {
		const deadline = new AbortController();
		const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
		const {service, client} = buildService(
			(_sessionId, signal) =>
				new Promise((_resolve, reject) =>
					signal?.addEventListener('abort', () =>
						reject(new EnableBankingClientError('provider_unreachable')),
					),
				),
		);

		const revocation = service.revokeSessions([
			{providerSessionId: 'encrypted:first'},
			{providerSessionId: 'encrypted:second'},
		]);
		expect(timeout).toHaveBeenCalledWith(CONSENT_REVOCATION_TIMEOUT_MS);
		expect(client.deleteSession.mock.calls.map(([, signal]) => signal)).toEqual([deadline.signal, deadline.signal]);

		deadline.abort();
		await expect(revocation).resolves.toBeUndefined();
	});
});
