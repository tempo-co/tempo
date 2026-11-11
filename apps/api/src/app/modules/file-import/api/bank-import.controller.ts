import {
	BadRequestException,
	Controller,
	Delete,
	Get,
	HttpCode,
	Param,
	ParseUUIDPipe,
	Post,
	UploadedFiles,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common';
import {Throttle, minutes} from '@nestjs/throttler';
import type {BankImportSummary} from '@tempo/contracts';

import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';
import {CsrfOriginGuard} from '@modules/auth/guards/csrf-origin.guard';

import {BankImportService} from '../bank-import.service';
import {BankImportUploadInterceptor} from './bank-import-upload.interceptor';
import {FileImportEnabledGuard} from './file-import-enabled.guard';

const NO_FILES = 'Choose at least one file to import.';

@Controller('bank-imports')
@UseGuards(FileImportEnabledGuard)
export class BankImportController {
	constructor(private readonly bankImportService: BankImportService) {}

	// A multipart form is a request any site can make, so the origin is checked like a refresh.
	@Post()
	@HttpCode(201)
	@UseGuards(CsrfOriginGuard)
	@Throttle({default: {limit: 10, ttl: minutes(1)}})
	@UseInterceptors(BankImportUploadInterceptor)
	async importFiles(
		@UploadedFiles() files: {buffer: Buffer}[] | undefined,
		@CurrentAccount() account: Account,
	): Promise<BankImportSummary> {
		if (!files?.length) throw new BadRequestException(NO_FILES);
		return this.bankImportService.importFiles(
			account.id,
			files.map(({buffer}) => buffer),
		);
	}

	@Get()
	async findAll(@CurrentAccount() account: Account): Promise<BankImportSummary[]> {
		return this.bankImportService.findAll(account.id);
	}

	@Delete(':importId')
	@HttpCode(204)
	@UseGuards(CsrfOriginGuard)
	async undo(
		@Param('importId', new ParseUUIDPipe({version: '4'})) importId: string,
		@CurrentAccount() account: Account,
	): Promise<void> {
		await this.bankImportService.undo(account.id, importId);
	}
}
