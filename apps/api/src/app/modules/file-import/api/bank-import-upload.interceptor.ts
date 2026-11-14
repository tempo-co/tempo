import {
	BadRequestException,
	CallHandler,
	ExecutionContext,
	Injectable,
	NestInterceptor,
	PayloadTooLargeException,
} from '@nestjs/common';
import {FilesInterceptor} from '@nestjs/platform-express';
import type {MulterOptions} from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import {Request, Response} from 'express';
import {Writable} from 'node:stream';
import {Observable, finalize} from 'rxjs';

import {BankImportRefusalException} from '../bank-import-refusal.exception';
import {MAX_DROP_BYTES, MAX_FILES_PER_DROP, MAX_FILE_BYTES, MULTIPART_ALLOWANCE_BYTES} from '../parsers/parse-limits';
import {BankImportUploadQueue, ReleaseUploadSlot, UploadWaitEnded} from './bank-import-upload-queue';

export const BANK_IMPORT_FILES_FIELD = 'files';
/** The text fields the route reads: the account to import into, or the account per statement that names none. */
export const BANK_IMPORT_ACCOUNT_FIELD = 'bankAccountId';
export const BANK_IMPORT_ACCOUNT_CHOICES_FIELD = 'accountChoices';
const TEXT_FIELDS: readonly string[] = [BANK_IMPORT_ACCOUNT_FIELD, BANK_IMPORT_ACCOUNT_CHOICES_FIELD];
/** The most an upload's body may hold: the drop's files together, plus the multipart framing around them. */
const MAX_UPLOAD_BYTES = MAX_DROP_BYTES + MULTIPART_ALLOWANCE_BYTES;
/** Seconds a busy refusal asks the client to wait before sending the same files again. */
const BUSY_RETRY_AFTER_SECONDS = 10;
const FILES_SEEN = Symbol('bankImportFilesSeen');
const RELEASE_SLOT = Symbol('bankImportReleaseSlot');

type UploadRequest = Request & {[FILES_SEEN]?: number; [RELEASE_SLOT]?: ReleaseUploadSlot};

/**
 * Feeds the body to busboy like multer does, counting it on the way. Once it passes `MAX_UPLOAD_BYTES` the upload is
 * refused at once: busboy stops (multer then drops the files read so far) and the slot is free for the next upload
 * while multer discards the rest of the body. The count does not trust a declared length, which can be missing.
 */
function countingStreamHandler(request: UploadRequest, busboy: Writable) {
	let received = 0;
	const count = (chunk: Buffer) => {
		received += chunk.length;
		if (received <= MAX_UPLOAD_BYTES) return;
		stop();
		request[RELEASE_SLOT]?.();
		busboy.destroy(new BankImportRefusalException('drop_too_large'));
	};
	const stop = () => request.off('data', count);
	// Added in the same tick as the pipe, so both see every chunk; the pipe still pauses the body for busboy.
	request.pipe(busboy);
	request.on('data', count);
	request.once('end', stop);
	request.once('close', stop);
}

// Without a storage or destination, multer keeps each file in memory as a buffer.
const Upload = FilesInterceptor(BANK_IMPORT_FILES_FIELD, MAX_FILES_PER_DROP + 1, {
	// The route reads two short text fields; more fields are refused instead of collected in memory. 4 KB holds an
	// account choice for every currency a bank offers.
	limits: {fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_DROP + 1, fields: TEXT_FIELDS.length, fieldSize: 4096},
	// Counts files as they arrive, so a size refusal can name the file by its position.
	fileFilter: (request, file, accept) => {
		const counted = request as UploadRequest;
		const seen = (counted[FILES_SEEN] ?? 0) + 1;
		counted[FILES_SEEN] = seen;
		if (file.fieldname !== BANK_IMPORT_FILES_FIELD)
			return accept(new BadRequestException('Unexpected field.'), false);
		if (seen > MAX_FILES_PER_DROP) return accept(new BankImportRefusalException('too_many_files'), false);
		accept(null, true);
	},
	// Multer's own option, which Nest's options type does not list.
	streamHandler: countingStreamHandler,
} as MulterOptions);

/** Resolves once the rest of the body is read and dropped, so the client can read the refusal it was sent. */
function discardBody(request: Request): Promise<void> {
	return new Promise((resolve) => {
		if (request.readableEnded || request.destroyed) return resolve();
		request.once('end', () => resolve());
		request.once('close', () => resolve());
		request.once('error', () => resolve());
		request.resume();
	});
}

/**
 * Reads the `files` field into memory with the drop's limits, refuses any text field but `bankAccountId` and
 * `accountChoices`, and turns multer's limit errors into typed refusals. Nothing reaches disk.
 *
 * Each upload first takes one of the queue's slots and keeps it until its import has finished or failed, so at most
 * two drops are held in memory at once. A drop declared larger than 25 MB together is refused without waiting for a
 * slot, its body read and dropped so the client can read the refusal; one counted larger as it streams is refused
 * then, keeping nothing more of it.
 */
@Injectable()
export class BankImportUploadInterceptor implements NestInterceptor {
	private readonly upload = new Upload();

	constructor(private readonly queue: BankImportUploadQueue) {}

	async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
		const http = context.switchToHttp();
		const request = http.getRequest<UploadRequest>();
		const response = http.getResponse<Response>();

		if (Number(request.headers['content-length']) > MAX_UPLOAD_BYTES) {
			await discardBody(request);
			throw new BankImportRefusalException('drop_too_large');
		}

		const release = await this.waitForSlot(request, response);
		request[RELEASE_SLOT] = release;
		let handedOver = false;
		try {
			const checkedNext: CallHandler = {
				handle: () => {
					const body = request.body as Record<string, unknown> | undefined;
					if (Object.keys(body ?? {}).some((field) => !TEXT_FIELDS.includes(field))) {
						throw new BadRequestException('Unexpected field.');
					}
					return next.handle();
				},
			};
			const handled = await this.upload.intercept(context, checkedNext);
			handedOver = true;
			// The files stay in memory until the import is done, whether it succeeds, is refused or fails.
			return handled.pipe(finalize(release));
		} catch (error) {
			if (error instanceof PayloadTooLargeException) {
				throw new BankImportRefusalException('file_too_large', request[FILES_SEEN] ?? null);
			}
			throw error;
		} finally {
			if (!handedOver) release();
		}
	}

	/** Waits for a slot before multer reads a byte; a client that leaves while waiting leaves the queue too. */
	private async waitForSlot(request: Request, response: Response): Promise<ReleaseUploadSlot> {
		const left = new AbortController();
		const onClose = () => left.abort();
		response.once('close', onClose);
		try {
			if (request.destroyed || response.destroyed) left.abort();
			return await this.queue.acquire(left.signal);
		} catch (error) {
			if (error instanceof UploadWaitEnded && error.reason === 'timeout') {
				response.setHeader('Retry-After', String(BUSY_RETRY_AFTER_SECONDS));
				throw new BankImportRefusalException('import_busy');
			}
			if (error instanceof UploadWaitEnded) throw new BadRequestException(error.message);
			throw error;
		} finally {
			response.off('close', onClose);
		}
	}
}
