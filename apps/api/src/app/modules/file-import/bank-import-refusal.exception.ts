import {HttpException, HttpStatus} from '@nestjs/common';
import type {BankImportError, BankImportErrorCode} from '@tempo/contracts';

const REFUSALS: Record<BankImportErrorCode, {status: HttpStatus; message: string}> = {
	unsupported_format: {
		status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
		message: 'This file type is not supported. Export a CAMT.053 statement from your bank.',
	},
	file_too_large: {status: HttpStatus.PAYLOAD_TOO_LARGE, message: 'A file can be at most 10 MB.'},
	archive_too_large: {status: HttpStatus.PAYLOAD_TOO_LARGE, message: 'An archive can unpack to at most 50 MB.'},
	too_many_files: {
		status: HttpStatus.UNPROCESSABLE_ENTITY,
		message: 'Drop at most 20 files at once, with at most 500 statements in an archive.',
	},
	too_many_rows: {status: HttpStatus.UNPROCESSABLE_ENTITY, message: 'One drop can hold at most 50,000 transactions.'},
	parse_failed: {status: HttpStatus.UNPROCESSABLE_ENTITY, message: 'This file could not be read.'},
	parse_timeout: {status: HttpStatus.UNPROCESSABLE_ENTITY, message: 'Reading this file took too long.'},
	synced_account_not_supported_yet: {
		status: HttpStatus.CONFLICT,
		message: 'This statement belongs to an account Tempo already syncs. Importing into it is not supported yet.',
	},
};

/** A refused drop. Nothing was written; `file` names the refused file by its 1-based position, not its name. */
export class BankImportRefusalException extends HttpException {
	constructor(
		readonly code: BankImportErrorCode,
		file: number | null = null,
	) {
		const {status, message} = REFUSALS[code];
		super({statusCode: status, message, code, file} satisfies BankImportError, status);
	}
}
