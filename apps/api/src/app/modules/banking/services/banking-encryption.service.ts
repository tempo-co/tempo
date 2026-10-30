import {Injectable} from '@nestjs/common';
import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';

import {ConfigurationService} from '@core/config/config.service';

import {BankingEncryptionError} from '../errors/banking-encryption.error';

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ENCRYPTION_ALGORITHM = 'aes-256-gcm' as const;

@Injectable()
export class BankingEncryptionService {
	private readonly key: Buffer;

	constructor(config: ConfigurationService) {
		const key = Buffer.from(config.get('BANKING_SESSION_ENCRYPTION_KEY_B64'), 'base64');

		if (key.length !== KEY_LENGTH) {
			throw new BankingEncryptionError('invalid_configuration');
		}

		this.key = key;
	}

	encrypt(value: string): string {
		try {
			const iv = randomBytes(IV_LENGTH);
			const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.key, iv);
			const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
			const authTag = cipher.getAuthTag();

			return Buffer.concat([iv, authTag, encrypted]).toString('base64url');
		} catch {
			throw new BankingEncryptionError('encryption_failed');
		}
	}

	decrypt(value: string): string {
		try {
			const payload = Buffer.from(value, 'base64url');

			if (payload.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
				throw new BankingEncryptionError('invalid_ciphertext');
			}

			const iv = payload.subarray(0, IV_LENGTH);
			const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
			const encrypted = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
			const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, this.key, iv);
			decipher.setAuthTag(authTag);

			return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
		} catch (error) {
			if (error instanceof BankingEncryptionError) throw error;
			throw new BankingEncryptionError('invalid_ciphertext');
		}
	}
}
