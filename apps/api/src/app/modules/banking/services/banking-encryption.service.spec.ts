import {ConfigurationService} from '@core/config/config.service';

import {BankingEncryptionError} from '../errors/banking-encryption.error';
import {BankingEncryptionService} from './banking-encryption.service';

describe('BankingEncryptionService', () => {
	const validKey = Buffer.alloc(32, 1).toString('base64');

	const createConfig = (key: string) => ({get: jest.fn().mockReturnValue(key)}) as unknown as ConfigurationService;

	it('encrypts and decrypts a provider session id', () => {
		const service = new BankingEncryptionService(createConfig(validKey));

		const encrypted = service.encrypt('provider-session-id');

		expect(encrypted).not.toContain('provider-session-id');
		expect(service.decrypt(encrypted)).toBe('provider-session-id');
	});

	it('rejects an incorrectly sized encryption key during startup', () => {
		expect(() => new BankingEncryptionService(createConfig('not-a-32-byte-key'))).toThrow(BankingEncryptionError);

		try {
			new BankingEncryptionService(createConfig('not-a-32-byte-key'));
		} catch (error) {
			expect(error).toMatchObject({code: 'invalid_configuration'});
		}
	});

	it('rejects malformed or tampered ciphertext with a typed error', () => {
		const service = new BankingEncryptionService(createConfig(validKey));
		const tamperedPayload = Buffer.from(service.encrypt('provider-session-id'), 'base64url');
		tamperedPayload[0] ^= 1;
		const tamperedCiphertext = tamperedPayload.toString('base64url');

		for (const ciphertext of ['malformed-ciphertext', tamperedCiphertext]) {
			expect(() => service.decrypt(ciphertext)).toThrow(BankingEncryptionError);

			try {
				service.decrypt(ciphertext);
			} catch (error) {
				expect(error).toMatchObject({code: 'invalid_ciphertext'});
			}
		}
	});
});
