import {
	BadRequestException,
	Body,
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
import type {BankImportDoubtfulRow, BankImportSummary} from '@tempo/contracts';
import {isUUID} from 'class-validator';

import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';
import {CsrfOriginGuard} from '@modules/auth/guards/csrf-origin.guard';

import {BankImportService} from '../bank-import.service';
import {BANK_IMPORT_ACCOUNT_FIELD, BankImportUploadInterceptor} from './bank-import-upload.interceptor';
import {FileImportEnabledGuard} from './file-import-enabled.guard';
import {ResolveBankImportDoubtfulRowDto} from './resolve-bank-import-doubtful-row.dto';

const NO_FILES = 'Choose at least one file to import.';
const INVALID_ACCOUNT_ID = 'bankAccountId must be a UUID.';
const UUID_PIPE = new ParseUUIDPipe({version: '4'});

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
		@Body(BANK_IMPORT_ACCOUNT_FIELD) bankAccountId: unknown,
		@CurrentAccount() account: Account,
	): Promise<BankImportSummary> {
		if (!files?.length) throw new BadRequestException(NO_FILES);
		if (bankAccountId !== undefined && !(typeof bankAccountId === 'string' && isUUID(bankAccountId))) {
			throw new BadRequestException(INVALID_ACCOUNT_ID);
		}
		return this.bankImportService.importFiles(
			account.id,
			files.map(({buffer}) => buffer),
			bankAccountId ?? null,
		);
	}

	@Get()
	async findAll(@CurrentAccount() account: Account): Promise<BankImportSummary[]> {
		return this.bankImportService.findAll(account.id);
	}

	@Get(':importId/doubtful-rows')
	async findDoubtfulRows(
		@Param('importId', UUID_PIPE) importId: string,
		@CurrentAccount() account: Account,
	): Promise<BankImportDoubtfulRow[]> {
		return this.bankImportService.findDoubtfulRows(account.id, importId);
	}

	@Post(':importId/doubtful-rows/:rowId/resolve')
	@HttpCode(200)
	@UseGuards(CsrfOriginGuard)
	async resolveDoubtfulRow(
		@Param('importId', UUID_PIPE) importId: string,
		@Param('rowId', UUID_PIPE) rowId: string,
		@Body() body: ResolveBankImportDoubtfulRowDto,
		@CurrentAccount() account: Account,
	): Promise<BankImportSummary> {
		return this.bankImportService.resolveDoubtfulRow(account.id, importId, rowId, body);
	}

	@Delete(':importId')
	@HttpCode(204)
	@UseGuards(CsrfOriginGuard)
	async undo(@Param('importId', UUID_PIPE) importId: string, @CurrentAccount() account: Account): Promise<void> {
		await this.bankImportService.undo(account.id, importId);
	}
}
