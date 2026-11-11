import {ConflictException} from '@nestjs/common';
import type {BankConnectionErrorCode} from '@tempo/contracts';

import {BANKING_FILE_CONNECTION_NOT_SYNCABLE} from '../api/constants/banking-messages.constants';

/** Refresh and re-authorization of the imported-files connection: it has no bank to contact. */
export class FileConnectionNotSyncableException extends ConflictException {
	constructor() {
		const code: BankConnectionErrorCode = 'file_connection_not_syncable';
		super({statusCode: 409, error: 'Conflict', message: BANKING_FILE_CONNECTION_NOT_SYNCABLE, code});
	}
}
