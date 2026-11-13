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
import type {
	BankImportDoubtfulRow,
	BankImportLayout,
	BankImportLayoutProposal,
	BankImportList,
	BankImportSummary,
} from '@tempo/contracts';
import {isUUID} from 'class-validator';

import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';

import {BankImportLayoutService} from '../bank-import-layout.service';
import {BankImportRefusalException} from '../bank-import-refusal.exception';
import {ACCOUNT_CHOICE_NEW, AccountChoices, BankImportService} from '../bank-import.service';
import {
	BANK_IMPORT_ACCOUNT_CHOICES_FIELD,
	BANK_IMPORT_ACCOUNT_FIELD,
	BankImportUploadInterceptor,
} from './bank-import-upload.interceptor';
import {ConfirmBankImportLayoutProposalDto} from './confirm-bank-import-layout-proposal.dto';
import {FileImportEnabledGuard} from './file-import-enabled.guard';
import {ResolveBankImportDoubtfulRowDto} from './resolve-bank-import-doubtful-row.dto';

const NO_FILES = 'Choose at least one file to import.';
const INVALID_ACCOUNT_ID = 'bankAccountId must be a UUID.';
const ACCOUNT_FIELDS_COMBINED = 'Send bankAccountId or accountChoices, not both.';
const ONE_FILE = 'Send exactly one file.';
const UUID_PIPE = new ParseUUIDPipe({version: '4'});

@Controller('bank-imports')
@UseGuards(FileImportEnabledGuard)
export class BankImportController {
	constructor(
		private readonly bankImportService: BankImportService,
		private readonly layoutService: BankImportLayoutService,
	) {}

	@Post()
	@HttpCode(201)
	@Throttle({default: {limit: 10, ttl: minutes(1)}})
	@UseInterceptors(BankImportUploadInterceptor)
	async importFiles(
		@UploadedFiles() files: {buffer: Buffer}[] | undefined,
		@Body(BANK_IMPORT_ACCOUNT_FIELD) bankAccountId: unknown,
		@Body(BANK_IMPORT_ACCOUNT_CHOICES_FIELD) accountChoices: unknown,
		@CurrentAccount() account: Account,
	): Promise<BankImportSummary> {
		if (!files?.length) throw new BadRequestException(NO_FILES);
		if (bankAccountId !== undefined && !(typeof bankAccountId === 'string' && isUUID(bankAccountId))) {
			throw new BadRequestException(INVALID_ACCOUNT_ID);
		}
		if (bankAccountId !== undefined && accountChoices !== undefined) {
			throw new BadRequestException(ACCOUNT_FIELDS_COMBINED);
		}
		const buffers = files.map(({buffer}) => buffer);
		if (accountChoices !== undefined) {
			return this.bankImportService.importFiles(account.id, buffers, {
				accountChoices: parseAccountChoices(accountChoices),
			});
		}
		return this.bankImportService.importFiles(account.id, buffers, {bankAccountId: bankAccountId ?? null});
	}

	@Get()
	async findAll(@CurrentAccount() account: Account): Promise<BankImportList> {
		return {imports: await this.bankImportService.findAll(account.id), mapper: this.layoutService.mapperEnabled()};
	}

	/** One file whose columns no reader knows: one model call, under the upload's limits and slots. */
	@Post('layout-proposals')
	@HttpCode(201)
	@Throttle({default: {limit: 10, ttl: minutes(1)}})
	@UseInterceptors(BankImportUploadInterceptor)
	async proposeLayout(
		@UploadedFiles() files: {buffer: Buffer}[] | undefined,
		@Body() fields: Record<string, unknown> | undefined,
		@CurrentAccount() account: Account,
	): Promise<BankImportLayoutProposal> {
		if (files?.length !== 1 || Object.keys(fields ?? {}).length > 0) throw new BadRequestException(ONE_FILE);
		return this.layoutService.propose(account.id, files[0].buffer);
	}

	@Post('layout-proposals/:proposalId/confirm')
	@HttpCode(201)
	async confirmLayout(
		@Param('proposalId', UUID_PIPE) proposalId: string,
		@Body() body: ConfirmBankImportLayoutProposalDto,
		@CurrentAccount() account: Account,
	): Promise<BankImportLayout> {
		return this.layoutService.confirm(account.id, proposalId, body);
	}

	@Post('layout-proposals/:proposalId/reject')
	@HttpCode(204)
	async rejectLayout(
		@Param('proposalId', UUID_PIPE) proposalId: string,
		@CurrentAccount() account: Account,
	): Promise<void> {
		await this.layoutService.reject(account.id, proposalId);
	}

	@Get('layouts')
	async findLayouts(@CurrentAccount() account: Account): Promise<BankImportLayout[]> {
		return this.layoutService.findLayouts(account.id);
	}

	@Delete('layouts/:layoutId')
	@HttpCode(204)
	async removeLayout(
		@Param('layoutId', UUID_PIPE) layoutId: string,
		@CurrentAccount() account: Account,
	): Promise<void> {
		await this.layoutService.removeLayout(account.id, layoutId);
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
	async undo(@Param('importId', UUID_PIPE) importId: string, @CurrentAccount() account: Account): Promise<void> {
		await this.bankImportService.undo(account.id, importId);
	}
}

/**
 * `accountChoices` as sent: a JSON object from `<bank>:<currency>` to a bank account id or `new`. Anything else
 * answers no question the drop can ask, so it is refused like a choice that does not fit.
 */
function parseAccountChoices(value: unknown): AccountChoices {
	let parsed: unknown;
	try {
		parsed = typeof value === 'string' ? JSON.parse(value) : null;
	} catch {
		parsed = null;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new BankImportRefusalException('target_account_mismatch');
	}
	const choices = new Map<string, string>();
	for (const [key, choice] of Object.entries(parsed)) {
		if (typeof choice !== 'string' || !(choice === ACCOUNT_CHOICE_NEW || isUUID(choice))) {
			throw new BankImportRefusalException('target_account_mismatch');
		}
		choices.set(key, choice);
	}
	return choices;
}
