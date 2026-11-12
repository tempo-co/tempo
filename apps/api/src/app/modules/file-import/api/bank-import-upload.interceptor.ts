import {
	BadRequestException,
	CallHandler,
	ExecutionContext,
	Injectable,
	NestInterceptor,
	PayloadTooLargeException,
} from '@nestjs/common';
import {FilesInterceptor} from '@nestjs/platform-express';
import {Request} from 'express';
import {Observable} from 'rxjs';

import {BankImportRefusalException} from '../bank-import-refusal.exception';
import {MAX_FILES_PER_DROP, MAX_FILE_BYTES} from '../parsers/parse-limits';

export const BANK_IMPORT_FILES_FIELD = 'files';
/** The text fields the route reads: the account to import into, or the account per statement that names none. */
export const BANK_IMPORT_ACCOUNT_FIELD = 'bankAccountId';
export const BANK_IMPORT_ACCOUNT_CHOICES_FIELD = 'accountChoices';
const TEXT_FIELDS: readonly string[] = [BANK_IMPORT_ACCOUNT_FIELD, BANK_IMPORT_ACCOUNT_CHOICES_FIELD];
const FILES_SEEN = Symbol('bankImportFilesSeen');

type CountedRequest = Request & {[FILES_SEEN]?: number};

// Without a storage or destination, multer keeps each file in memory as a buffer.
const Upload = FilesInterceptor(BANK_IMPORT_FILES_FIELD, MAX_FILES_PER_DROP + 1, {
	// The route reads two short text fields; more fields are refused instead of collected in memory. 4 KB holds an
	// account choice for every currency a bank offers.
	limits: {fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_DROP + 1, fields: TEXT_FIELDS.length, fieldSize: 4096},
	// Counts files as they arrive, so a size refusal can name the file by its position.
	fileFilter: (request, file, accept) => {
		const counted = request as CountedRequest;
		const seen = (counted[FILES_SEEN] ?? 0) + 1;
		counted[FILES_SEEN] = seen;
		if (file.fieldname !== BANK_IMPORT_FILES_FIELD)
			return accept(new BadRequestException('Unexpected field.'), false);
		if (seen > MAX_FILES_PER_DROP) return accept(new BankImportRefusalException('too_many_files'), false);
		accept(null, true);
	},
});

/**
 * Reads the `files` field into memory with the drop's limits, refuses any text field but `bankAccountId` and
 * `accountChoices`, and turns multer's limit errors into typed refusals. Nothing reaches disk.
 */
@Injectable()
export class BankImportUploadInterceptor implements NestInterceptor {
	private readonly upload = new Upload();

	async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
		const checkedNext: CallHandler = {
			handle: () => {
				const body = context.switchToHttp().getRequest<Request>().body as Record<string, unknown> | undefined;
				if (Object.keys(body ?? {}).some((field) => !TEXT_FIELDS.includes(field))) {
					throw new BadRequestException('Unexpected field.');
				}
				return next.handle();
			},
		};
		try {
			return await this.upload.intercept(context, checkedNext);
		} catch (error) {
			if (error instanceof PayloadTooLargeException) {
				const seen = context.switchToHttp().getRequest<CountedRequest>()[FILES_SEEN] ?? null;
				throw new BankImportRefusalException('file_too_large', seen);
			}
			throw error;
		}
	}
}
