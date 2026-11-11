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
const FILES_SEEN = Symbol('bankImportFilesSeen');

type CountedRequest = Request & {[FILES_SEEN]?: number};

// Without a storage or destination, multer keeps each file in memory as a buffer.
const Upload = FilesInterceptor(BANK_IMPORT_FILES_FIELD, MAX_FILES_PER_DROP + 1, {
	limits: {fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_DROP + 1},
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
 * Reads the `files` field into memory with the drop's limits and turns multer's limit errors into typed refusals.
 * Nothing reaches disk.
 */
@Injectable()
export class BankImportUploadInterceptor implements NestInterceptor {
	private readonly upload = new Upload();

	async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
		try {
			return await this.upload.intercept(context, next);
		} catch (error) {
			if (error instanceof PayloadTooLargeException) {
				const seen = context.switchToHttp().getRequest<CountedRequest>()[FILES_SEEN] ?? null;
				throw new BankImportRefusalException('file_too_large', seen);
			}
			throw error;
		}
	}
}
