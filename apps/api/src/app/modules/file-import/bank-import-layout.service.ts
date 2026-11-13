import {BadRequestException, ConflictException, Injectable, Logger, NotFoundException} from '@nestjs/common';
import type {
	BankImportLayoutColumn,
	BankImportLayoutMapping,
	BankImportLayoutPreview,
	BankImportLayoutPreviewRow,
	BankImportLayoutProposal as BankImportLayoutProposalResponse,
	BankImportLayout as BankImportLayoutResponse,
	ConfirmBankImportLayoutProposalRequest,
} from '@tempo/contracts';
import {createHash, randomUUID} from 'node:crypto';
import {DataSource, EntityManager, MoreThan} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {Account} from '@modules/account/account.entity';

import {BankImportLayoutProposal, LayoutProposalStatus} from './bank-import-layout-proposal.entity';
import {BankImportLayout, savedLayoutId} from './bank-import-layout.entity';
import {BankImportRefusalException} from './bank-import-refusal.exception';
import {LayoutMapper, LayoutMapperError} from './mapper/layout-mapper';
import {LayoutAnswer, toMapperInput} from './mapper/layout-mapper.contract';
import {CsvLayout, MAX_SKIP_AFTER, MAX_SKIP_BEFORE, validateCsvLayout} from './parsers/csv-layout';
import {ISO_CURRENCY_CODES} from './parsers/currency-codes';
import {amountScale, formatUnits, parseDecimal} from './parsers/decimal';
import {NormalizedRow, NormalizedStatement, STATEMENT_BANKS} from './parsers/parse-result';
import {TableSample} from './parsers/table-sample';
import {ParseRunnerService} from './runner/parse-runner.service';

/** Model calls an owner may start in 24 hours, whatever their outcome. */
export const MAX_PROPOSALS_PER_DAY = 5;
export const PROPOSAL_LIFETIME_MS = 60 * 60 * 1000;
export const MAX_SAVED_LAYOUTS = 50;
/** A saved layout's JSON at most: an owner's 50 always fit one request to the parse child. */
export const MAX_SAVED_LAYOUT_BYTES = 16 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BANK_NAME_LENGTH = 60;
const PREVIEW_FIRST_ROWS = 5;
const PREVIEW_LAST_ROWS = 2;
/** The layout id while it is only proposed; a confirmed layout takes `savedLayoutId`. */
const PROPOSED_LAYOUT_ID = 'proposed';
/** The bank of a proposed layout until the owner names it. */
const PROPOSED_BANK = 'Proposed';
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]+/g;

export const LAYOUT_PROPOSAL_NOT_FOUND = 'Proposal not found.';
export const LAYOUT_PROPOSAL_DECIDED = 'This proposal has already been decided.';
export const LAYOUT_NOT_FOUND = 'Layout not found.';
export const INVALID_BANK_NAME = 'Name the bank in 1 to 60 characters.';
export const INVALID_CURRENCY = 'Choose the currency of this file.';
export const CURRENCY_NOT_ASKED = 'This file states its currency.';
/** A bank whose built-in files name no account: a layout under its name would share its imported-files accounts. */
const reservedBankName = (bank: string) =>
	`${bank}'s own exports already import into your ${bank} accounts. Name this bank differently.`;

/**
 * Works out the columns of a file no reader claims, with one model call that sees only a masked sample, and keeps the
 * layouts owners confirm. A layout is offered only when it reads every row of the file.
 */
@Injectable()
export class BankImportLayoutService {
	private readonly logger = new Logger(BankImportLayoutService.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly parseRunner: ParseRunnerService,
		private readonly mapper: LayoutMapper,
		private readonly configurationService: ConfigurationService,
	) {}

	/** Whether this deployment works out unknown files' columns. */
	mapperEnabled(): boolean {
		return this.configurationService.get('FILE_IMPORT_MAPPER_ENABLED') === true;
	}

	/**
	 * The owner's saved layouts as the parse child reads them, newest first. A stored layout that no longer validates
	 * as its own row is left out.
	 */
	async ownedLayouts(ownerId: Account['id']): Promise<CsvLayout[]> {
		const rows = await this.dataSource.getRepository(BankImportLayout).find({
			where: {accountId: ownerId},
			order: {createdAt: 'DESC', id: 'DESC'},
			take: MAX_SAVED_LAYOUTS,
		});
		return rows.flatMap((row) => {
			const validation = validateCsvLayout(row.layout);
			const fits =
				validation.ok &&
				validation.layout.id === savedLayoutId(row.id) &&
				validation.layout.bank === row.bankName;
			return fits ? [validation.layout] : [];
		});
	}

	async findLayouts(ownerId: Account['id']): Promise<BankImportLayoutResponse[]> {
		const rows = await this.dataSource.getRepository(BankImportLayout).find({
			where: {accountId: ownerId},
			order: {createdAt: 'DESC', id: 'DESC'},
		});
		return rows.map(toLayoutResponse);
	}

	/** Removes a saved layout. What it imported stays; later drops are no longer read with it. */
	async removeLayout(ownerId: Account['id'], layoutId: string): Promise<void> {
		const result = await this.dataSource.getRepository(BankImportLayout).delete({id: layoutId, accountId: ownerId});
		if (!result.affected) throw new NotFoundException(LAYOUT_NOT_FOUND);
	}

	/**
	 * Finds the file's table in the parse child, asks the model once with its masked sample, checks the answer as a
	 * layout and reads the whole file with it in the parse child. Every model call counts against the owner's daily
	 * limit; a refusal before it (off, not a table, a table the limits do not allow) does not.
	 */
	async propose(ownerId: Account['id'], file: Buffer): Promise<BankImportLayoutProposalResponse> {
		if (!this.mapperEnabled()) throw this.refuse('mapper_unavailable');
		const sampled = await this.parseRunner.sample(file);
		if (!sampled.ok) throw this.refuse(sampled.code);
		const {sample} = sampled;
		if (sample.skipBefore > MAX_SKIP_BEFORE || sample.skipAfter > MAX_SKIP_AFTER) {
			throw this.refuse('layout_not_mappable');
		}
		const owner = await this.dataSource.getRepository(Account).findOneByOrFail({id: ownerId});
		const proposal = await this.reserve(ownerId, file, sample);

		let answer: LayoutAnswer;
		try {
			answer = await this.mapper.mapLayout(toMapperInput(sample));
		} catch (error) {
			const code =
				error instanceof LayoutMapperError && error.reason === 'invalid'
					? 'layout_not_mappable'
					: 'mapper_unavailable';
			throw await this.fail(proposal, code);
		}
		const defaultCurrency = owner.baseCurrency ?? 'EUR';
		const built = buildLayout(answer, sample, defaultCurrency);
		const validation = built && validateCsvLayout(built.layout);
		if (!built || !validation?.ok) throw await this.fail(proposal, 'layout_not_mappable');
		const preview = await this.parseRunner.preview(file, validation.layout);
		if (!preview.ok) throw await this.fail(proposal, 'layout_not_mappable');

		await this.dataSource
			.getRepository(BankImportLayoutProposal)
			.update(
				{id: proposal.id, accountId: ownerId},
				{layout: validation.layout, currencyNeeded: built.currencyNeeded},
			);
		return {
			id: proposal.id,
			expiresAt: proposal.expiresAt.toISOString(),
			bankName: bankNameOf(answer.bankName),
			currencyNeeded: built.currencyNeeded,
			defaultCurrency,
			mapping: mappingOf(validation.layout, sample.header),
			dateCheck: preview.dateCheck,
			preview: previewOf(preview.statements),
		};
	}

	/** Saves the proposal's layout for the owner, under the bank they named and in the currency they chose. */
	async confirm(
		ownerId: Account['id'],
		proposalId: string,
		request: ConfirmBankImportLayoutProposalRequest,
	): Promise<BankImportLayoutResponse> {
		const bankName =
			typeof request.bankName === 'string' ? request.bankName.replace(CONTROL_CHARACTERS, ' ').trim() : '';
		if (!bankName || bankName.length > MAX_BANK_NAME_LENGTH) throw new BadRequestException(INVALID_BANK_NAME);
		const reserved = STATEMENT_BANKS.find((bank) => bank.toLowerCase() === bankName.toLowerCase());
		if (reserved) throw new BadRequestException(reservedBankName(reserved));
		return this.dataSource.transaction(async (manager) => {
			await lockOwner(manager, ownerId);
			const proposal = await this.lockProposal(manager, ownerId, proposalId);
			if (proposal.expiresAt.getTime() <= Date.now())
				throw new BankImportRefusalException('layout_proposal_expired');
			if (proposal.currencyNeeded) {
				if (typeof request.currency !== 'string' || !ISO_CURRENCY_CODES.has(request.currency)) {
					throw new BadRequestException(INVALID_CURRENCY);
				}
			} else if (request.currency !== undefined) {
				throw new BadRequestException(CURRENCY_NOT_ASKED);
			}
			const layouts = manager.getRepository(BankImportLayout);
			if ((await layouts.count({where: {accountId: ownerId}})) >= MAX_SAVED_LAYOUTS) {
				throw new BankImportRefusalException('layout_limit_reached');
			}
			const id = randomUUID();
			const validation = validateCsvLayout({
				...proposal.layout,
				id: savedLayoutId(id),
				bank: bankName,
				...(proposal.currencyNeeded ? {currency: {fixed: request.currency}} : {}),
			});
			// Only a layout stored by an older build of these checks gets here.
			if (!validation.ok) throw new ConflictException(LAYOUT_PROPOSAL_DECIDED);
			if (Buffer.byteLength(JSON.stringify(validation.layout)) > MAX_SAVED_LAYOUT_BYTES) {
				throw new BankImportRefusalException('layout_not_mappable');
			}
			const saved = await layouts.save(
				layouts.create({id, accountId: ownerId, layout: validation.layout, bankName}),
			);
			await manager.getRepository(BankImportLayoutProposal).update({id: proposal.id}, {status: 'confirmed'});
			return toLayoutResponse(saved);
		});
	}

	/** Discards a proposal the owner found wrong; nothing is saved. */
	async reject(ownerId: Account['id'], proposalId: string): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			const proposal = await this.lockProposal(manager, ownerId, proposalId);
			await manager.getRepository(BankImportLayoutProposal).update({id: proposal.id}, {status: 'rejected'});
		});
	}

	/**
	 * Records the proposal before the model is asked, under the owner's row lock, so two requests at once cannot both
	 * pass the daily limit.
	 */
	private reserve(ownerId: Account['id'], file: Buffer, sample: TableSample): Promise<BankImportLayoutProposal> {
		return this.dataSource.transaction(async (manager) => {
			await lockOwner(manager, ownerId);
			const proposals = manager.getRepository(BankImportLayoutProposal);
			const since = new Date(Date.now() - DAY_MS);
			const recent = await proposals.find({
				select: {id: true, createdAt: true},
				where: {accountId: ownerId, createdAt: MoreThan(since)},
				order: {createdAt: 'ASC'},
			});
			if (recent.length >= MAX_PROPOSALS_PER_DAY) {
				// The oldest of the day's calls leaves the window first.
				const retryAt = new Date(recent[recent.length - MAX_PROPOSALS_PER_DAY].createdAt.getTime() + DAY_MS);
				throw this.refuse('mapper_limit_reached', {retryAt: retryAt.toISOString()});
			}
			const now = new Date();
			return proposals.save(
				proposals.create({
					accountId: ownerId,
					fileHash: createHash('sha256').update(file).digest('hex'),
					status: 'proposed' satisfies LayoutProposalStatus,
					failureCode: null,
					headerCells: sample.header,
					columnShapes: sample.masked.columnShapes,
					layout: null,
					currencyNeeded: false,
					expiresAt: new Date(now.getTime() + PROPOSAL_LIFETIME_MS),
				}),
			);
		});
	}

	private async fail(
		proposal: BankImportLayoutProposal,
		code: 'mapper_unavailable' | 'layout_not_mappable',
	): Promise<BankImportRefusalException> {
		await this.dataSource
			.getRepository(BankImportLayoutProposal)
			.update({id: proposal.id, accountId: proposal.accountId}, {status: 'failed', failureCode: code});
		return this.refuse(code);
	}

	/** An owned proposal still open, locked for this transaction. */
	private async lockProposal(
		manager: EntityManager,
		ownerId: Account['id'],
		proposalId: string,
	): Promise<BankImportLayoutProposal & {layout: CsvLayout}> {
		const proposal = await manager.getRepository(BankImportLayoutProposal).findOne({
			where: {id: proposalId, accountId: ownerId},
			lock: {mode: 'pessimistic_write'},
		});
		if (!proposal) throw new NotFoundException(LAYOUT_PROPOSAL_NOT_FOUND);
		if (proposal.status !== 'proposed' || !proposal.layout) throw new ConflictException(LAYOUT_PROPOSAL_DECIDED);
		return proposal as BankImportLayoutProposal & {layout: CsvLayout};
	}

	/** A refusal of the proposal's one file, counted in the logs by its code alone. */
	private refuse(
		code: ConstructorParameters<typeof BankImportRefusalException>[0],
		extra: {retryAt?: string} = {},
	): BankImportRefusalException {
		this.logger.log(`Layout proposal refused: ${code}`);
		return new BankImportRefusalException(code, 1, undefined, undefined, extra.retryAt);
	}
}

async function lockOwner(manager: EntityManager, ownerId: Account['id']): Promise<void> {
	await manager.query('SELECT "id" FROM "accounts" WHERE "id" = $1 FOR UPDATE', [ownerId]);
}

function toLayoutResponse(row: BankImportLayout): BankImportLayoutResponse {
	return {id: row.id, bankName: row.bankName, createdAt: row.createdAt.toISOString()};
}

/** The model's bank guess as plain text of at most 60 characters; null when it gave none. */
function bankNameOf(value: string | null): string | null {
	const name = value?.replace(CONTROL_CHARACTERS, ' ').trim().slice(0, MAX_BANK_NAME_LENGTH).trim();
	return name || null;
}

/**
 * The layout the answer describes, on the table the parse child found: its header (or column count), source and
 * skipped lines come from the file, the columns and formats from the answer. Only the answer's layout fields are
 * used. Null when the answer names a currency that is no ISO 4217 code; `validateCsvLayout` checks everything else,
 * such as an account line that is not above the table.
 */
export function buildLayout(
	answer: LayoutAnswer,
	sample: TableSample,
	defaultCurrency: string,
): {layout: unknown; currencyNeeded: boolean} | null {
	const {shape} = sample;
	if (answer.currency && 'code' in answer.currency && !ISO_CURRENCY_CODES.has(answer.currency.code)) return null;
	const {amount} = answer;
	return {
		currencyNeeded: answer.currency === null,
		layout: {
			id: PROPOSED_LAYOUT_ID,
			bank: PROPOSED_BANK,
			recognize: sample.header ? {header: sample.header} : {columnCount: sample.columnCount},
			...(shape.source === 'xlsx'
				? {source: 'xlsx'}
				: {delimiter: shape.delimiter, quote: shape.quote, encoding: shape.encoding}),
			...(sample.skipBefore > 0 ? {skipBefore: sample.skipBefore} : {}),
			...(sample.skipAfter > 0 ? {skipAfter: sample.skipAfter} : {}),
			decimalMark: answer.decimalMark,
			amountStyle: {thousandsSeparator: answer.thousandsSeparator},
			dateFormat: answer.dateFormat,
			...(answer.account && 'column' in answer.account ? {accountIban: answer.account.column} : {}),
			...(answer.account && 'line' in answer.account ? {accountIbanLine: answer.account.line} : {}),
			currency:
				answer.currency === null
					? {fixed: defaultCurrency}
					: 'code' in answer.currency
						? {fixed: answer.currency.code}
						: {column: answer.currency.column},
			bookingDate: answer.bookingDate,
			...(answer.valueDate === null ? {} : {valueDate: answer.valueDate}),
			amount:
				amount.kind === 'signed'
					? {kind: 'signed', column: amount.column}
					: amount.kind === 'direction'
						? {
								kind: 'direction',
								column: amount.column,
								directionColumn: amount.directionColumn,
								debit: amount.moneyOut,
								credit: amount.moneyIn,
							}
						: {kind: 'debitCredit', debitColumn: amount.moneyOutColumn, creditColumn: amount.moneyInColumn},
			...(answer.balance ? {balance: answer.balance} : {}),
			...(answer.counterpartyName === null ? {} : {counterpartyName: answer.counterpartyName}),
			...(answer.counterpartyAccount === null ? {} : {counterpartyIban: answer.counterpartyAccount}),
			description: answer.description,
		},
	};
}

/** The layout in the owner's terms: each column (1-based) with its heading and what it holds. */
export function mappingOf(layout: CsvLayout, header: readonly string[] | null): BankImportLayoutMapping {
	const columns: BankImportLayoutColumn[] = [];
	const add = (field: BankImportLayoutColumn['field'], column: number | undefined) => {
		if (column !== undefined) columns.push({field, column: column + 1, header: header?.[column] || null});
	};
	add('date', layout.bookingDate);
	add('valueDate', layout.valueDate);
	const {amount} = layout;
	if (amount.kind === 'debitCredit') {
		add('moneyOut', amount.debitColumn);
		add('moneyIn', amount.creditColumn);
	} else {
		add('amount', amount.column);
		if (amount.kind === 'direction') add('direction', amount.directionColumn);
	}
	add('balance', layout.balance?.column);
	if ('column' in layout.currency) add('currency', layout.currency.column);
	add('account', layout.accountIban);
	add('counterparty', layout.counterpartyName);
	add('counterpartyAccount', layout.counterpartyIban);
	for (const column of layout.description) add('description', column);
	return {
		columns,
		amount: amount.kind,
		direction: amount.kind === 'direction' ? {moneyOut: amount.debit, moneyIn: amount.credit} : null,
		balance: layout.balance?.when ?? null,
		accountLine: layout.accountIbanLine === undefined ? null : layout.accountIbanLine + 1,
		dateFormat: layout.dateFormat,
	};
}

/** The rows as Tempo would store them: the first 5 and the last 2, counts, dates and totals per currency. */
export function previewOf(statements: readonly NormalizedStatement[]): BankImportLayoutPreview {
	const rows = statements.flatMap((statement) => statement.rows);
	const dates = rows.flatMap((row) => {
		const date = dayOf(row);
		return date ? [date] : [];
	});
	dates.sort();
	const totals = new Map<string, {moneyIn: bigint; moneyOut: bigint; scale: number}>();
	for (const row of rows) {
		const amount = parseDecimal(row.amount, '.')!;
		const total = totals.get(row.currency) ?? {moneyIn: 0n, moneyOut: 0n, scale: 2};
		if (amount.units < 0n) total.moneyOut -= amount.units;
		else total.moneyIn += amount.units;
		total.scale = amountScale({units: 0n, scale: total.scale}, amount);
		totals.set(row.currency, total);
	}
	return {
		rowCount: rows.length,
		dateFrom: dates[0] ?? null,
		dateTo: dates.at(-1) ?? null,
		firstRows: rows.slice(0, PREVIEW_FIRST_ROWS).map(previewRow),
		lastRows: rows.slice(Math.max(PREVIEW_FIRST_ROWS, rows.length - PREVIEW_LAST_ROWS)).map(previewRow),
		totals: [...totals.entries()].map(([currency, {moneyIn, moneyOut, scale}]) => ({
			currency,
			moneyIn: formatUnits(moneyIn, scale),
			moneyOut: formatUnits(moneyOut, scale),
		})),
		accounts: [...new Set(statements.flatMap(({accountIban}) => (accountIban ? [accountIban] : [])))],
	};
}

function dayOf(row: NormalizedRow): string | null {
	return row.bookingDate ?? row.valueDate ?? row.transactionDate;
}

function previewRow(row: NormalizedRow): BankImportLayoutPreviewRow {
	return {
		date: dayOf(row),
		amount: row.amount,
		currency: row.currency,
		counterparty: row.counterpartyName,
		description: row.description,
		balanceAfter: row.balanceAfter,
	};
}
