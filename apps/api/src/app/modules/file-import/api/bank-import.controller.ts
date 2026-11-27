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
	BankImportBanks,
	BankImportDoubtfulRow,
	BankImportLayout,
	BankImportLayoutProposal,
	BankImportList,
	BankImportNeverSentRow,
	BankImportPreview,
	BankImportSummary,
} from '@tempo/contracts';
import {isPickableBankId} from '@tempo/contracts';
import {isUUID} from 'class-validator';

import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';

import {BankImportLayoutService} from '../bank-import-layout.service';
import {BankImportRefusalException} from '../bank-import-refusal.exception';
import {ACCOUNT_CHOICE_NEW, AccountChoices, BankImportRequest, BankImportService} from '../bank-import.service';
import {BankRequestService} from '../bank-request.service';
import {AddBankImportNeverSentRowsDto} from './add-bank-import-never-sent-rows.dto';
import {
	BANK_IMPORT_ACCOUNT_CHOICES_FIELD,
	BANK_IMPORT_ACCOUNT_FIELD,
	BANK_IMPORT_BANK_FIELD,
	BankImportUploadInterceptor,
} from './bank-import-upload.interceptor';
import {ConfirmBankImportLayoutProposalDto} from './confirm-bank-import-layout-proposal.dto';
import {CreateBankRequestDto} from './create-bank-request.dto';
import {FileImportEnabledGuard} from './file-import-enabled.guard';
import {ResolveBankImportDoubtfulRowDto} from './resolve-bank-import-doubtful-row.dto';

const NO_FILES = 'Choose at least one file to import.';
const INVALID_ACCOUNT_ID = 'bankAccountId must be a UUID.';
const ACCOUNT_FIELDS_COMBINED = 'Send bankAccountId or accountChoices, not both.';
const ONE_FILE = 'Send exactly one file.';
export const INVALID_BANK_ID = 'bankId must name a bank of the list, or other.';
const UUID_PIPE = new ParseUUIDPipe({version: '4'});

@Controller('bank-imports')
@UseGuards(FileImportEnabledGuard)
export class BankImportController {
	constructor(
		private readonly bankImportService: BankImportService,
		private readonly layoutService: BankImportLayoutService,
		private readonly bankRequestService: BankRequestService,
	) {}

	@Post()
	@HttpCode(201)
	@Throttle({default: {limit: 10, ttl: minutes(1)}})
	@UseInterceptors(BankImportUploadInterceptor)
	async importFiles(
		@UploadedFiles() files: {buffer: Buffer}[] | undefined,
		@Body(BANK_IMPORT_ACCOUNT_FIELD) bankAccountId: unknown,
		@Body(BANK_IMPORT_ACCOUNT_CHOICES_FIELD) accountChoices: unknown,
		@Body(BANK_IMPORT_BANK_FIELD) bankField: unknown,
		@CurrentAccount() account: Account,
	): Promise<BankImportSummary> {
		const drop = parseDrop(files, bankAccountId, accountChoices, bankField);
		return this.bankImportService.importFiles(account.id, drop.files, drop.request);
	}

	/** The same drop and fields as an upload, read and routed without writing anything, for the owner to check. */
	@Post('preview')
	@HttpCode(200)
	@Throttle({default: {limit: 10, ttl: minutes(1)}})
	@UseInterceptors(BankImportUploadInterceptor)
	async previewFiles(
		@UploadedFiles() files: {buffer: Buffer}[] | undefined,
		@Body(BANK_IMPORT_ACCOUNT_FIELD) bankAccountId: unknown,
		@Body(BANK_IMPORT_ACCOUNT_CHOICES_FIELD) accountChoices: unknown,
		@Body(BANK_IMPORT_BANK_FIELD) bankField: unknown,
		@CurrentAccount() account: Account,
	): Promise<BankImportPreview> {
		const drop = parseDrop(files, bankAccountId, accountChoices, bankField);
		return this.bankImportService.previewFiles(account.id, drop.files, drop.request);
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
		const {[BANK_IMPORT_BANK_FIELD]: bankField, ...rest} = fields ?? {};
		if (!Array.isArray(files) || files.length !== 1 || Object.keys(rest).length > 0) {
			throw new BadRequestException(ONE_FILE);
		}
		return this.layoutService.propose(account.id, files[0].buffer, parseBankId(bankField));
	}

	/** "Tell us your bank": kept for the owner to count; nothing is sent back. */
	@Post('bank-requests')
	@HttpCode(204)
	@Throttle({default: {limit: 10, ttl: minutes(1)}})
	async requestBank(@Body() body: CreateBankRequestDto, @CurrentAccount() account: Account): Promise<void> {
		await this.bankRequestService.create(account.id, body);
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

	@Get('layout-proposals/:proposalId/banks')
	async findBanks(
		@Param('proposalId', UUID_PIPE) proposalId: string,
		@CurrentAccount() account: Account,
	): Promise<BankImportBanks> {
		return this.layoutService.knownBanks(account.id, proposalId);
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

	@Get(':importId/never-sent-rows')
	async findNeverSentRows(
		@Param('importId', UUID_PIPE) importId: string,
		@CurrentAccount() account: Account,
	): Promise<BankImportNeverSentRow[]> {
		return this.bankImportService.findNeverSentRows(account.id, importId);
	}

	@Post(':importId/never-sent-rows/add')
	@HttpCode(200)
	async addNeverSentRows(
		@Param('importId', UUID_PIPE) importId: string,
		@Body() body: AddBankImportNeverSentRowsDto,
		@CurrentAccount() account: Account,
	): Promise<BankImportSummary> {
		return this.bankImportService.addNeverSentRows(account.id, importId, body.rowIds);
	}

	@Delete(':importId')
	@HttpCode(204)
	async undo(@Param('importId', UUID_PIPE) importId: string, @CurrentAccount() account: Account): Promise<void> {
		await this.bankImportService.undo(account.id, importId);
	}
}

/** An upload's files and text fields as sent, checked: the files, and where the drop goes. */
function parseDrop(
	files: {buffer: Buffer}[] | undefined,
	bankAccountId: unknown,
	accountChoices: unknown,
	bankField: unknown,
): {files: Buffer[]; request: BankImportRequest} {
	// Checked as an array: a tampered request must not pass a look-alike with a length.
	if (!Array.isArray(files) || files.length === 0) throw new BadRequestException(NO_FILES);
	const bankId = parseBankId(bankField);
	if (bankAccountId !== undefined && !(typeof bankAccountId === 'string' && isUUID(bankAccountId))) {
		throw new BadRequestException(INVALID_ACCOUNT_ID);
	}
	if (bankAccountId !== undefined && accountChoices !== undefined) {
		throw new BadRequestException(ACCOUNT_FIELDS_COMBINED);
	}
	const buffers = files.map(({buffer}) => buffer);
	if (accountChoices !== undefined) {
		return {files: buffers, request: {accountChoices: parseAccountChoices(accountChoices), bankId}};
	}
	return {files: buffers, request: {bankAccountId: bankAccountId ?? null, bankId}};
}

/** `bankId` as sent: a bank of the list or `other`, else refused; null when the owner picked none. */
function parseBankId(value: unknown): string | null {
	if (value === undefined) return null;
	if (typeof value !== 'string' || !isPickableBankId(value)) throw new BadRequestException(INVALID_BANK_ID);
	return value;
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
