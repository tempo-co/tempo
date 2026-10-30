export type BankingEncryptionErrorCode = 'invalid_configuration' | 'encryption_failed' | 'invalid_ciphertext';

export class BankingEncryptionError extends Error {
	constructor(public readonly code: BankingEncryptionErrorCode) {
		super(code);
		this.name = 'BankingEncryptionError';
	}
}
