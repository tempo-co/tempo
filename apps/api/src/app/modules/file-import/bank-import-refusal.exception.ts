import {HttpException, HttpStatus} from '@nestjs/common';
import type {BankImportAccountQuestion, BankImportError, BankImportErrorCode} from '@tempo/contracts';

const REFUSALS: Record<BankImportErrorCode, {status: HttpStatus; message: string}> = {
	unsupported_format: {
		status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
		message:
			'This file type is not supported yet. Export a CAMT.053, MT940 or OFX statement, or one of the bank exports Tempo reads.',
	},
	layout_not_recognized: {
		status: HttpStatus.UNPROCESSABLE_ENTITY,
		message: "This file looks like a bank's CSV export, but its rows do not read the way that export's do.",
	},
	layout_unknown: {
		status: HttpStatus.UNPROCESSABLE_ENTITY,
		message: 'This file holds a table, but not in a layout Tempo knows.',
	},
	layout_not_mappable: {
		status: HttpStatus.UNPROCESSABLE_ENTITY,
		message: "Tempo couldn't work out this file's columns. Nothing was imported.",
	},
	mapper_unavailable: {
		status: HttpStatus.SERVICE_UNAVAILABLE,
		message: "Tempo can't work out file columns right now. This file isn't supported yet.",
	},
	// A typed refusal, not a 429: the web answers every 429 as the API's general rate limit.
	mapper_limit_reached: {
		status: HttpStatus.UNPROCESSABLE_ENTITY,
		message: 'Tempo has worked out the columns of 5 files in the last 24 hours. Try again later.',
	},
	layout_proposal_expired: {
		status: HttpStatus.GONE,
		message: 'This preview has expired. Work out the columns again.',
	},
	layout_limit_reached: {
		status: HttpStatus.CONFLICT,
		message: 'You have 50 saved layouts. Remove one first.',
	},
	legacy_xls_not_supported: {
		status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
		message:
			'Old Excel files (.xls) are not supported. Export the same statement as CAMT.053, MT940 or TXT instead, or from Revolut as CSV or Excel (.xlsx).',
	},
	file_too_large: {status: HttpStatus.PAYLOAD_TOO_LARGE, message: 'A file can be at most 10 MB.'},
	drop_too_large: {
		status: HttpStatus.PAYLOAD_TOO_LARGE,
		message: 'These files are too large together. One drop can hold at most 25 MB.',
	},
	archive_too_large: {status: HttpStatus.PAYLOAD_TOO_LARGE, message: 'An archive can unpack to at most 50 MB.'},
	too_many_files: {
		status: HttpStatus.UNPROCESSABLE_ENTITY,
		message: 'Drop at most 20 files at once, with at most 500 statements in an archive.',
	},
	too_many_rows: {status: HttpStatus.UNPROCESSABLE_ENTITY, message: 'One drop can hold at most 50,000 transactions.'},
	parse_failed: {status: HttpStatus.UNPROCESSABLE_ENTITY, message: 'This file could not be read.'},
	parse_timeout: {status: HttpStatus.UNPROCESSABLE_ENTITY, message: 'Reading this file took too long.'},
	ambiguous_target_account: {
		status: HttpStatus.CONFLICT,
		message: 'More than one of your accounts fits this statement. Choose the account to import into.',
	},
	target_account_unconfirmed: {
		status: HttpStatus.CONFLICT,
		message:
			'Few of these transactions were found in the account this statement would go to. Choose the account to import into.',
	},
	target_account_mismatch: {
		status: HttpStatus.UNPROCESSABLE_ENTITY,
		message: 'This file does not belong to the chosen account. Drop the statements of one account in its currency.',
	},
	account_busy: {
		status: HttpStatus.CONFLICT,
		message: 'This account is syncing with your bank. Try again in a moment.',
	},
	multiple_bank_connections: {
		status: HttpStatus.UNPROCESSABLE_ENTITY,
		message:
			'This drop holds statements of accounts from more than one bank connection. Import each bank separately.',
	},
	import_busy: {
		status: HttpStatus.SERVICE_UNAVAILABLE,
		message: 'Other files are being imported. Try again in a moment.',
	},
};

/**
 * A refused drop. Nothing was written; `file` names the refused file by its 1-based position, not its name.
 * `accountQuestions` lists the statements the owner must choose an account for; `layout` names the CSV layout a
 * file refused with `layout_not_recognized` looked like; `retryAt` says when an owner at the column mapper's daily
 * limit may ask again.
 */
export class BankImportRefusalException extends HttpException {
	constructor(
		readonly code: BankImportErrorCode,
		file: number | null = null,
		accountQuestions?: BankImportAccountQuestion[],
		layout?: string,
		retryAt?: string,
	) {
		const {status, message} = REFUSALS[code];
		const body: BankImportError = {statusCode: status, message, code, file};
		if (accountQuestions) body.accountQuestions = accountQuestions;
		if (layout) body.layout = layout;
		if (retryAt) body.retryAt = retryAt;
		super(body, status);
	}
}
