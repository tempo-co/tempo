import {BadRequestException, ConflictException, Injectable, Logger, NotFoundException} from '@nestjs/common';
import type {
	BankImportAccountCandidate,
	BankImportAccountQuestion,
	BankImportDoubtfulRow as BankImportDoubtfulRowResponse,
	BankImportSummary,
	ResolveBankImportDoubtfulRowRequest,
} from '@tempo/contracts';
import {createHash} from 'node:crypto';
import {DataSource, EntityManager, In, IsNull, Not, Raw} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {
	MATCH_WINDOW_DAYS,
	MatchExistingRow,
	MatchOutcome,
	matchDay,
	matchTransactions,
} from '@modules/banking/bank-transaction-matcher';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {BATCH_WRITE_CHUNK_SIZE, chunkArray, safeErrorName} from '@modules/banking/banking.utils';
import {BankTransactionCategorizationService} from '@modules/banking/categorization/bank-transaction-categorization.service';
import {MerchantLogoService} from '@modules/banking/merchant-logos/merchant-logo.service';
import {isIbanIdentificationHash, verifyIbanAgainstIdentificationHash} from '@modules/banking/own-transfer/iban';
import {
	BankTransactionInput,
	BankTransactionPersistenceService,
} from '@modules/banking/services/bank-transaction-persistence.service';
import {
	BankingConnectionLock,
	BankingConnectionLockService,
} from '@modules/banking/services/banking-connection-lock.service';
import {
	BANK_CONNECTION_PROVIDERS,
	BANK_CONNECTION_STATUSES,
	BANK_SYNC_STATUSES,
	FILE_CONNECTION_ASPSP,
} from '@modules/banking/services/banking-sync.constants';
import {CurrencyExchangeService} from '@modules/banking/services/currency-exchange.service';
import {OwnTransferService} from '@modules/banking/services/own-transfer.service';

import {BankImportDoubtfulRow} from './bank-import-doubtful-row.entity';
import {BankImportRefusalException} from './bank-import-refusal.exception';
import {BankImport} from './bank-import.entity';
import {MAX_ROWS_PER_DROP} from './parsers/parse-limits';
import {NormalizedRow, NormalizedStatement, StatementBank, StatementFormat} from './parsers/parse-result';
import {ParseRunnerService} from './runner/parse-runner.service';

export const BANK_IMPORT_NOT_FOUND = 'Import not found.';
export const BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND = 'Row not found.';
const BANK_IMPORT_NOT_SAVED = 'The import could not be saved. Please try again.';
const BANK_IMPORT_DOUBTFUL_ROW_RESOLVED = 'This row has already been decided.';
const BANK_IMPORT_NOT_A_CANDIDATE = 'Choose one of the transactions this row may be.';
/** How long an import waits for a running sync of the same connection before refusing with `account_busy`. */
const SYNC_LOCK_WAIT_MS = 10_000;
/**
 * A statement that names no account, routed by its bank to a synced account, is refused as unconfirmed when at least
 * this many of its rows fall within the dates that account already holds and none of them is found there. A chosen
 * value, not a measured one: enough rows that a real export of the account would almost surely share one.
 */
export const UNCONFIRMED_TARGET_MIN_OVERLAP_ROWS = 5;

/** The `accountChoices` value that sends a statement to the imported-files account of its bank and currency. */
export const ACCOUNT_CHOICE_NEW = 'new';
/** The owner's answers to `accountQuestions`: `<bank>:<currency>` to a bank account id or `new`. */
export type AccountChoices = ReadonlyMap<string, string>;
/** Where the request says a drop goes: one named account, or a choice per statement that names no account. */
export type BankImportRequest = {bankAccountId?: BankAccount['id'] | null; accountChoices?: AccountChoices};

/** The statements of one account in one drop: its rows per format, in matching order (`FORMAT_ORDER`), each in booking order. */
type AccountRows = {
	identifier: string;
	iban: string | null;
	/** The bank of a file that names no account (Revolut); null when it names one. */
	bank: StatementBank | null;
	currency: string;
	byFormat: {format: StatementFormat; rows: NormalizedRow[]}[];
};

/**
 * The order the formats of one account in one drop are matched in: each format's rows meet the rows the formats
 * before it added as if they were already stored, so one payment exported in several formats is imported once.
 */
const FORMAT_ORDER: readonly StatementFormat[] = ['camt053', 'mt940', 'abnAmroTxt', 'revolutCsv', 'revolutXlsx'];

/** Where an account's rows go: an account bank sync writes to, or an imported-files account found or created. */
type Target = {kind: 'synced'; account: BankAccount} | {kind: 'file'; account?: BankAccount};

/** A statement's target, and whether it was found by bank and currency alone (the case the unconfirmed guard checks). */
type RoutedTarget = {target: Target; routedByBank: boolean};

type ImportedAccount = {account: BankAccount; connection: BankConnection; created: boolean};

type LadderCounts = Pick<
	BankImport,
	'rowsAdded' | 'rowsMatchedByReference' | 'rowsMatchedByBalance' | 'rowsMatchedByDate' | 'rowsDoubtful'
>;

@Injectable()
export class BankImportService {
	private readonly logger = new Logger(BankImportService.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly parseRunner: ParseRunnerService,
		private readonly persistence: BankTransactionPersistenceService,
		private readonly connectionLockService: BankingConnectionLockService,
		private readonly ownTransferService: OwnTransferService,
		private readonly currencyExchangeService: CurrencyExchangeService,
		private readonly categorizationService: BankTransactionCategorizationService,
		private readonly merchantLogoService: MerchantLogoService,
	) {}

	/**
	 * Imports one drop, all or nothing. A statement goes to the account the request names (`bankAccountId`, or its
	 * `accountChoices` entry), else to the owner's synced account with its IBAN and currency (for a file that names no
	 * account, the one synced account at its bank in that currency, once the file's rows confirm it), or else to an
	 * imported-files account. Each row runs the duplicate ladder against the account's stored rows: matched rows are
	 * skipped, doubtful rows are held for the owner, and only new rows are inserted.
	 */
	async importFiles(
		ownerId: Account['id'],
		files: readonly Buffer[],
		{bankAccountId = null, accountChoices = new Map()}: BankImportRequest = {},
	): Promise<BankImportSummary> {
		const {statements, formats} = await this.parseDrop(files);
		const accountRows = groupByAccount(statements);
		const allRows = accountRows.flatMap(({byFormat}) => byFormat.flatMap(({rows}) => rows));
		const bookingDates = allRows.flatMap(({bookingDate}) => (bookingDate ? [bookingDate] : [])).sort();
		const rowsParsed = allRows.length;
		const targets = bankAccountId
			? [await this.findNamedTarget(ownerId, bankAccountId, accountRows)]
			: await this.findRoutedTargets(ownerId, accountRows, accountChoices);

		const syncedConnectionIds = [
			...new Set(
				targets.flatMap((target) => (target.kind === 'synced' ? [target.account.bankConnection.id] : [])),
			),
		];
		// The record hangs on one connection and goes with it, so a drop may write to one synced connection at most.
		if (syncedConnectionIds.length > 1) throw new BankImportRefusalException('multiple_bank_connections');

		const locks = await this.lockSyncedConnections(syncedConnectionIds);
		let result: {record: BankImport; accounts: ImportedAccount[]; persistedTransactionIds: string[]};
		try {
			result = await this.dataSource.transaction(async (manager) => {
				const {accounts, fileConnection} = await this.resolveTargets(manager, ownerId, accountRows, targets);
				const syncedAccount = accounts.find(
					({connection}) => connection.provider !== BANK_CONNECTION_PROVIDERS.FILE,
				);
				const imports = manager.getRepository(BankImport);
				const record = await imports.save(
					imports.create({
						accountId: ownerId,
						// Removing the synced connection takes the record along with the rows it tracks; removing the
						// imported-files connection takes only its own accounts, and the record still undoes the rest.
						bankConnectionId: (syncedAccount?.connection ?? fileConnection!).id,
						fileHash: hashDrop(files),
						format: formats.size === 1 ? [...formats][0] : 'mixed',
						layout: null,
						filesCount: files.length,
						rowsParsed,
						rowsAdded: 0,
						rowsAlreadyPresent: 0,
						rowsMatchedByReference: 0,
						rowsMatchedByBalance: 0,
						rowsMatchedByDate: 0,
						rowsDoubtful: 0,
						dateFrom: bookingDates[0] ?? null,
						dateTo: bookingDates.at(-1) ?? null,
						bankAccountIds: accounts.map(({account}) => account.id),
						createdBankAccountIds: accounts.filter(({created}) => created).map(({account}) => account.id),
					}),
				);

				const counts: LadderCounts = {
					rowsAdded: 0,
					rowsMatchedByReference: 0,
					rowsMatchedByBalance: 0,
					rowsMatchedByDate: 0,
					rowsDoubtful: 0,
				};
				const persistedTransactionIds: string[] = [];
				for (const [index, {byFormat}] of accountRows.entries()) {
					const {account, connection} = accounts[index];
					// Candidates are read again per format, inside the transaction, so they include the rows the
					// formats before this one just inserted.
					for (const {rows} of byFormat) {
						const outcomes = matchTransactions(
							rows.map(toMatchRow),
							await this.findMatchCandidates(manager, account.id, rows),
						);
						const newRows = rows.filter((_, rowIndex) => outcomes[rowIndex].kind === 'new');
						if (newRows.length > 0) {
							const persisted = await this.persistence.persistTransactions(
								manager.getRepository(BankTransaction),
								account,
								newRows.map((row) => toTransactionInput(row, account.currency)),
								connection.aspspName,
								connection.provider,
								{importId: record.id},
							);
							persistedTransactionIds.push(...persisted.insertedTransactionIds);
						}
						const doubtful = rows.flatMap((row, rowIndex) => {
							const outcome = outcomes[rowIndex];
							return outcome.kind === 'doubtful'
								? [
										{
											importId: record.id,
											bankAccountId: account.id,
											row,
											candidateTransactionIds: outcome.candidateIds,
										},
									]
								: [];
						});
						for (const chunk of chunkArray(doubtful, BATCH_WRITE_CHUNK_SIZE)) {
							await manager.getRepository(BankImportDoubtfulRow).insert(chunk);
						}
						addLadderCounts(counts, outcomes);
					}
				}
				Object.assign(record, counts, {
					rowsAlreadyPresent:
						counts.rowsMatchedByReference + counts.rowsMatchedByBalance + counts.rowsMatchedByDate,
				});
				await imports.update({id: record.id}, {...counts, rowsAlreadyPresent: record.rowsAlreadyPresent});
				for (const lock of locks) lock.assertHealthy();
				return {record, accounts, persistedTransactionIds};
			});
		} finally {
			await this.releaseLocks(locks);
		}

		await this.afterRowsChanged(ownerId, result.persistedTransactionIds);
		return toSummary(
			result.record,
			result.accounts.map(({account}) => account),
		);
	}

	async findAll(ownerId: Account['id']): Promise<BankImportSummary[]> {
		const records = await this.dataSource.getRepository(BankImport).find({
			where: {accountId: ownerId},
			order: {createdAt: 'DESC', id: 'DESC'},
		});
		const accounts = await this.findOwnedAccounts(
			ownerId,
			records.flatMap(({bankAccountIds}) => bankAccountIds),
		);
		return records.map((record) => toSummary(record, accounts));
	}

	/**
	 * Deletes exactly the rows the import still owns (rows a sync took over are no longer its own) and its open
	 * doubtful rows, then any imported-files account left without rows. Pointers to deleted rows (own-transfer and
	 * exchange counterparts) are cleared by their foreign keys and recomputed after.
	 */
	async undo(ownerId: Account['id'], importId: BankImport['id']): Promise<void> {
		const owned = await this.findOwnedImport(ownerId, importId);
		const ownedAccounts = await this.findOwnedAccounts(ownerId, owned.bankAccountIds);
		const fileConnectionId = ownedAccounts.find(
			({bankConnection}) => bankConnection.provider === BANK_CONNECTION_PROVIDERS.FILE,
		)?.bankConnection.id;
		const locks = await this.lockSyncedConnections(
			ownedAccounts.flatMap((account) =>
				account.bankConnection.provider === BANK_CONNECTION_PROVIDERS.FILE ? [] : [account.bankConnection.id],
			),
		);
		try {
			await this.dataSource.transaction(async (manager) => {
				const {record} = await this.lockImport(manager, ownerId, owned);
				// The imported-files connection after the record's own, the order an import takes them in.
				const fileConnection =
					fileConnectionId &&
					(await manager.getRepository(BankConnection).findOne({
						where: {id: fileConnectionId, accountId: ownerId, provider: BANK_CONNECTION_PROVIDERS.FILE},
						lock: {mode: 'pessimistic_write'},
					}));
				await manager.query(
					`DELETE FROM "bank_transactions" bank_transaction
					USING "bank_accounts" bank_account, "bank_connections" connection
					WHERE bank_transaction."importId" = $1
						AND bank_account."id" = bank_transaction."bankAccountId"
						AND connection."id" = bank_account."bankConnectionId"
						AND connection."accountId" = $2`,
					[record.id, ownerId],
				);
				await manager.getRepository(BankImportDoubtfulRow).delete({importId: record.id, resolution: IsNull()});
				await manager
					.getRepository(BankImport)
					.update({id: record.id}, {undoneAt: new Date(), rowsDoubtful: 0});
				if (fileConnection) {
					await manager.query(
						`DELETE FROM "bank_accounts" bank_account
						USING "bank_connections" connection
						WHERE bank_account."bankConnectionId" = $1
							AND connection."id" = bank_account."bankConnectionId"
							AND connection."accountId" = $2
							AND NOT EXISTS (
								SELECT 1 FROM "bank_transactions" bank_transaction WHERE bank_transaction."bankAccountId" = bank_account."id"
							)
							AND NOT EXISTS (
								SELECT 1 FROM "bank_import_doubtful_rows" doubtful
								WHERE doubtful."bankAccountId" = bank_account."id" AND doubtful."resolution" IS NULL
							)`,
						[fileConnection.id, ownerId],
					);
				}
				for (const lock of locks) lock.assertHealthy();
			});
		} finally {
			await this.releaseLocks(locks);
		}

		await this.afterRowsChanged(ownerId, []);
	}

	/** The import's open doubtful rows in booking order, each with the candidates that still exist. */
	async findDoubtfulRows(
		ownerId: Account['id'],
		importId: BankImport['id'],
	): Promise<BankImportDoubtfulRowResponse[]> {
		const record = await this.dataSource
			.getRepository(BankImport)
			.findOne({where: {id: importId, accountId: ownerId}});
		if (!record) throw new NotFoundException(BANK_IMPORT_NOT_FOUND);
		const rows = await this.dataSource.getRepository(BankImportDoubtfulRow).find({
			where: {importId: record.id, resolution: IsNull()},
			order: {id: 'ASC'},
		});
		const candidateIds = [...new Set(rows.flatMap(({candidateTransactionIds}) => candidateTransactionIds))];
		const candidates = candidateIds.length
			? await this.dataSource.getRepository(BankTransaction).find({
					select: {
						id: true,
						bankAccountId: true,
						transactionDate: true,
						bookingDate: true,
						valueDate: true,
						amount: true,
						currency: true,
						displayDescription: true,
						counterpartyName: true,
					},
					where: {id: In(candidateIds), bankAccount: {bankConnection: {accountId: ownerId}}},
				})
			: [];
		const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
		return rows
			.map((doubtful) => ({
				id: doubtful.id,
				bankAccountId: doubtful.bankAccountId,
				row: {
					bookingDate: doubtful.row.bookingDate,
					valueDate: doubtful.row.valueDate,
					amount: doubtful.row.amount,
					currency: doubtful.row.currency,
					balanceAfter: doubtful.row.balanceAfter,
					bankReference: doubtful.row.bankReference,
					counterpartyName: doubtful.row.counterpartyName,
					description: doubtful.row.description,
					remittanceInformation: doubtful.row.remittanceInformation,
				},
				candidates: doubtful.candidateTransactionIds.flatMap((id) => {
					const candidate = candidatesById.get(id);
					if (!candidate || candidate.bankAccountId !== doubtful.bankAccountId) return [];
					return [
						{
							id,
							transactionDate: candidate.transactionDate,
							bookingDate: candidate.bookingDate,
							valueDate: candidate.valueDate,
							amount: candidate.amount,
							currency: candidate.currency,
							displayDescription: candidate.displayDescription,
							counterpartyName: candidate.counterpartyName,
						},
					];
				}),
			}))
			.sort((left, right) => (matchDay(left.row) ?? '').localeCompare(matchDay(right.row) ?? ''));
	}

	/**
	 * Decides one doubtful row: `new` inserts it as a row of the import, `duplicate` records which candidate it is
	 * and inserts nothing. A row is decided once.
	 */
	async resolveDoubtfulRow(
		ownerId: Account['id'],
		importId: BankImport['id'],
		rowId: BankImportDoubtfulRow['id'],
		request: ResolveBankImportDoubtfulRowRequest,
	): Promise<BankImportSummary> {
		const owned = await this.findOwnedImport(ownerId, importId);
		const doubtful = await this.dataSource
			.getRepository(BankImportDoubtfulRow)
			.findOne({where: {id: rowId, importId: owned.id}});
		const [account] = doubtful ? await this.findOwnedAccounts(ownerId, [doubtful.bankAccountId]) : [];
		if (!doubtful || !account?.bankConnection) throw new NotFoundException(BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND);
		const connection = account.bankConnection;
		const locks = await this.lockSyncedConnections(
			connection.provider === BANK_CONNECTION_PROVIDERS.FILE ? [] : [connection.id],
		);
		let resolved: {record: BankImport; insertedTransactionIds: string[]};
		try {
			resolved = await this.dataSource.transaction(async (manager) => {
				const {record} = await this.lockImport(manager, ownerId, owned);
				const rows = manager.getRepository(BankImportDoubtfulRow);
				const current = await rows.findOne({where: {id: doubtful.id}, lock: {mode: 'pessimistic_write'}});
				if (!current) throw new NotFoundException(BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND);
				if (current.resolution) throw new ConflictException(BANK_IMPORT_DOUBTFUL_ROW_RESOLVED);

				let resolvedTransactionId: string;
				const insertedTransactionIds: string[] = [];
				if (request.decision === 'duplicate') {
					const transactionId = request.transactionId;
					const candidate =
						transactionId && current.candidateTransactionIds.includes(transactionId)
							? await manager.getRepository(BankTransaction).findOne({
									select: {id: true},
									where: {id: transactionId, bankAccountId: current.bankAccountId},
								})
							: null;
					if (!candidate) throw new BadRequestException(BANK_IMPORT_NOT_A_CANDIDATE);
					resolvedTransactionId = candidate.id;
					record.rowsAlreadyPresent += 1;
				} else {
					const persisted = await this.persistence.persistTransactions(
						manager.getRepository(BankTransaction),
						account,
						[toTransactionInput(current.row, account.currency)],
						connection.aspspName,
						connection.provider,
						{importId: record.id},
					);
					insertedTransactionIds.push(...persisted.insertedTransactionIds);
					resolvedTransactionId = persisted.insertedTransactionIds[0];
					record.rowsAdded += 1;
				}
				record.rowsDoubtful -= 1;
				await rows.update({id: current.id}, {resolution: request.decision, resolvedTransactionId});
				await manager.getRepository(BankImport).update(
					{id: record.id},
					{
						rowsAdded: record.rowsAdded,
						rowsAlreadyPresent: record.rowsAlreadyPresent,
						rowsDoubtful: record.rowsDoubtful,
					},
				);
				for (const lock of locks) lock.assertHealthy();
				return {record, insertedTransactionIds};
			});
		} finally {
			await this.releaseLocks(locks);
		}

		await this.afterRowsChanged(ownerId, resolved.insertedTransactionIds);
		return toSummary(resolved.record, await this.findOwnedAccounts(ownerId, resolved.record.bankAccountIds));
	}

	/** Parses every file in request order; the first refusal names its file and nothing is written. */
	private async parseDrop(
		files: readonly Buffer[],
	): Promise<{statements: NormalizedStatement[]; formats: Set<StatementFormat>}> {
		const statements: NormalizedStatement[] = [];
		const formats = new Set<StatementFormat>();
		const seen = new Set<string>();
		let rows = 0;
		for (const [index, file] of files.entries()) {
			const outcome = await this.parseRunner.parse(file);
			if (!outcome.ok) throw new BankImportRefusalException(outcome.code, index + 1);
			for (const format of outcome.result.formats) formats.add(format);
			for (const statement of outcome.result.statements) {
				// A statement dropped twice in one go (an archive and its own files) is the same statement.
				const key = JSON.stringify(statement);
				if (seen.has(key)) continue;
				seen.add(key);
				rows += statement.rows.length;
				if (rows > MAX_ROWS_PER_DROP) throw new BankImportRefusalException('too_many_rows', index + 1);
				statements.push(statement);
			}
		}
		return {statements, formats};
	}

	/**
	 * The target of each statement of a request that names no single account. A statement of a file that names no
	 * account and has an `accountChoices` entry goes where the owner chose. The others go to the synced account with
	 * their IBAN and currency (stored IBAN, or the identification hash); for a file that names no account, the synced
	 * account in its currency at a connection of its bank. Otherwise an imported-files account.
	 *
	 * Refuses, listing every statement that needs an answer: `ambiguous_target_account` when two synced accounts fit
	 * a statement, else `target_account_unconfirmed` when a statement routed by its bank alone is not confirmed by the
	 * account's stored rows (`isTargetConfirmed`).
	 */
	private async findRoutedTargets(
		ownerId: Account['id'],
		accountRows: readonly AccountRows[],
		accountChoices: AccountChoices,
	): Promise<Target[]> {
		const keys = accountRows.map(({bank, currency}) => (bank ? accountChoiceKey(bank, currency) : null));
		for (const key of accountChoices.keys()) {
			if (!keys.includes(key)) throw new BankImportRefusalException('target_account_mismatch');
		}
		const syncedAccounts = accountRows.some(({iban, bank}) => iban || bank)
			? await this.dataSource.getRepository(BankAccount).find({
					where: {bankConnection: {accountId: ownerId, provider: Not(BANK_CONNECTION_PROVIDERS.FILE)}},
					relations: {bankConnection: true},
					order: {id: 'ASC'},
				})
			: [];
		const routed: Array<RoutedTarget | null> = [];
		const ambiguous: Array<{index: number; matches: BankAccount[]}> = [];
		for (const [index, rows] of accountRows.entries()) {
			const choice = keys[index] === null ? undefined : accountChoices.get(keys[index]);
			if (choice !== undefined) {
				routed.push({target: await this.findChosenTarget(ownerId, choice, rows), routedByBank: false});
				continue;
			}
			const {iban, bank, currency} = rows;
			const matches = syncedAccounts.filter(
				(account) =>
					account.currency === currency &&
					(iban
						? normalizeStoredIban(account.iban) === iban ||
							verifyIbanAgainstIdentificationHash(account.identificationHash, iban, currency)
						: !!bank && account.bankConnection.aspspName.trim().toLowerCase() === bank.toLowerCase()),
			);
			if (matches.length > 1) {
				ambiguous.push({index, matches});
				routed.push(null);
			} else {
				routed.push({
					target: matches.length === 1 ? {kind: 'synced', account: matches[0]} : {kind: 'file'},
					routedByBank: !!bank && matches.length === 1,
				});
			}
		}

		// Read without the sync lock: this only decides whether to ask the owner, and the ladder runs again under it.
		const unconfirmed: number[] = [];
		for (const [index, entry] of routed.entries()) {
			if (!entry?.routedByBank || entry.target.kind !== 'synced') continue;
			if (!(await this.isTargetConfirmed(ownerId, entry.target.account, accountRows[index]))) {
				unconfirmed.push(index);
			}
		}
		if (ambiguous.length === 0 && unconfirmed.length === 0) return routed.map((entry) => entry!.target);

		const questions: Array<{index: number; candidates: BankAccount[]}> = ambiguous.map(({index, matches}) => ({
			index,
			candidates: matches,
		}));
		if (unconfirmed.length > 0) {
			const ownedAccounts = await this.dataSource.getRepository(BankAccount).find({
				where: {bankConnection: {accountId: ownerId}},
				relations: {bankConnection: true},
				order: {id: 'ASC'},
			});
			for (const index of unconfirmed) {
				const routedTo = (routed[index]!.target as {account: BankAccount}).account;
				questions.push({
					index,
					// The account the statement would have gone to first, then every other account in its currency.
					candidates: [
						routedTo,
						...ownedAccounts.filter(
							({id, currency}) => id !== routedTo.id && currency === accountRows[index].currency,
						),
					],
				});
			}
		}
		throw new BankImportRefusalException(
			ambiguous.length > 0 ? 'ambiguous_target_account' : 'target_account_unconfirmed',
			null,
			questions
				.sort((left, right) => left.index - right.index)
				.flatMap(({index, candidates}) => {
					const {bank, currency} = accountRows[index];
					return bank ? [{bank, currency, candidates: candidates.map(toAccountCandidate)}] : [];
				}) satisfies BankImportAccountQuestion[],
		);
	}

	/** The owner's `accountChoices` answer for a statement that names no account: any account of theirs in its currency. */
	private async findChosenTarget(ownerId: Account['id'], choice: string, rows: AccountRows): Promise<Target> {
		if (choice === ACCOUNT_CHOICE_NEW) return {kind: 'file'};
		const [account] = await this.findOwnedAccounts(ownerId, [choice]);
		if (!account?.bankConnection || account.currency !== rows.currency) {
			throw new BankImportRefusalException('target_account_mismatch');
		}
		return account.bankConnection.provider === BANK_CONNECTION_PROVIDERS.FILE
			? {kind: 'file', account}
			: {kind: 'synced', account};
	}

	/**
	 * Whether a statement found only by its bank and currency looks like the synced account's own history. It is
	 * unconfirmed when at least `UNCONFIRMED_TARGET_MIN_OVERLAP_ROWS` of its rows (in the format that has the most)
	 * fall within the first and last day the account stores, and the ladder matches none of those rows against the
	 * stored rows. A doubtful row is no match. A statement outside the stored dates, or overlapping them by fewer
	 * rows, is confirmed: there is nothing to compare it with.
	 */
	private async isTargetConfirmed(ownerId: Account['id'], account: BankAccount, rows: AccountRows): Promise<boolean> {
		const range = (await this.dataSource
			.getRepository(BankTransaction)
			.createQueryBuilder('transaction')
			.innerJoin('transaction.bankAccount', 'bankAccount')
			.innerJoin('bankAccount.bankConnection', 'connection')
			.select(
				`to_char(MIN(COALESCE("transaction"."bookingDate", "transaction"."valueDate")), 'YYYY-MM-DD')`,
				'from',
			)
			.addSelect(
				`to_char(MAX(COALESCE("transaction"."bookingDate", "transaction"."valueDate")), 'YYYY-MM-DD')`,
				'to',
			)
			.where('transaction.bankAccountId = :bankAccountId', {bankAccountId: account.id})
			.andWhere('connection.accountId = :ownerId', {ownerId})
			.getRawOne<{from: string | null; to: string | null}>()) ?? {from: null, to: null};
		if (!range.from || !range.to) return true;
		const {from, to} = range;
		let overlap = 0;
		for (const {rows: formatRows} of rows.byFormat) {
			const inRange = formatRows.flatMap((row, index) => {
				const day = matchDay(row);
				return day && day >= from && day <= to ? [index] : [];
			});
			if (inRange.length === 0) continue;
			const outcomes = matchTransactions(
				formatRows.map(toMatchRow),
				await this.findMatchCandidates(this.dataSource.manager, account.id, formatRows),
			);
			if (inRange.some((index) => outcomes[index].kind === 'matched')) return true;
			overlap = Math.max(overlap, inRange.length);
		}
		return overlap < UNCONFIRMED_TARGET_MIN_OVERLAP_ROWS;
	}

	/** The account the request names; the drop must be one account in its currency that does not contradict it. */
	private async findNamedTarget(
		ownerId: Account['id'],
		bankAccountId: BankAccount['id'],
		accountRows: readonly AccountRows[],
	): Promise<Target> {
		const [account] = await this.findOwnedAccounts(ownerId, [bankAccountId]);
		if (!account?.bankConnection || accountRows.length !== 1 || accountRows[0].currency !== account.currency) {
			throw new BankImportRefusalException('target_account_mismatch');
		}
		const {iban, bank, currency} = accountRows[0];
		if (account.bankConnection.provider === BANK_CONNECTION_PROVIDERS.FILE) {
			// A file that names no account fits any account in its currency.
			if (!bank && account.providerAccountId !== fileAccountIdentity(accountRows[0]).providerAccountId) {
				throw new BankImportRefusalException('target_account_mismatch');
			}
			return {kind: 'file', account};
		}
		const storedIban = normalizeStoredIban(account.iban);
		const contradicts = iban
			? storedIban
				? storedIban !== iban
				: isIbanIdentificationHash(account.identificationHash) &&
					!verifyIbanAgainstIdentificationHash(account.identificationHash, iban, currency)
			: false;
		if (contradicts) throw new BankImportRefusalException('target_account_mismatch');
		return {kind: 'synced', account};
	}

	/**
	 * Takes the sync lock of every synced connection the import writes to, in id order, so it never interleaves
	 * with a sync, a removal or another import of those connections.
	 */
	private async lockSyncedConnections(connectionIds: readonly string[]): Promise<BankingConnectionLock[]> {
		const locks: BankingConnectionLock[] = [];
		try {
			for (const connectionId of [...new Set(connectionIds)].sort()) {
				locks.push(await this.connectionLockService.acquire(connectionId, {waitForMs: SYNC_LOCK_WAIT_MS}));
			}
		} catch (error) {
			await this.releaseLocks(locks);
			if (error instanceof ConflictException) throw new BankImportRefusalException('account_busy');
			throw error;
		}
		return locks;
	}

	private async releaseLocks(locks: readonly BankingConnectionLock[]): Promise<void> {
		for (const lock of locks) {
			lock.stop();
			try {
				await lock.release();
			} catch (error) {
				this.logger.warn(`Bank import lock release failed: ${safeErrorName(error)}`);
			}
		}
	}

	/**
	 * The account and connection for each statement inside the import transaction. Synced accounts are read again
	 * under their sync lock; imported-files accounts are found or created under the locked imported-files connection.
	 */
	private async resolveTargets(
		manager: EntityManager,
		ownerId: Account['id'],
		accountRows: readonly AccountRows[],
		targets: readonly Target[],
	): Promise<{accounts: ImportedAccount[]; fileConnection: BankConnection | null}> {
		// A drop without a synced target (even one without accounts) is recorded under the imported-files connection.
		const fileConnection =
			targets.length === 0 || targets.some(({kind}) => kind === 'file')
				? await this.lockFileConnection(manager, ownerId)
				: null;
		const accounts: ImportedAccount[] = [];
		for (const [index, target] of targets.entries()) {
			if (target.kind === 'file' && target.account) {
				// The imported-files account the request names, read again under the locked connection.
				const account = await manager.getRepository(BankAccount).findOne({
					where: {id: target.account.id, bankConnection: {id: fileConnection!.id, accountId: ownerId}},
				});
				// Only an undo or removal committing before the lock was taken gets here.
				if (!account) throw new ConflictException(BANK_IMPORT_NOT_SAVED);
				accounts.push({account, connection: fileConnection!, created: false});
				continue;
			}
			if (target.kind === 'file') {
				accounts.push(await this.findOrCreateFileAccount(manager, fileConnection!, accountRows[index]));
				continue;
			}
			const account = await manager.getRepository(BankAccount).findOne({
				where: {
					id: target.account.id,
					bankConnection: {id: target.account.bankConnection.id, accountId: ownerId},
				},
				relations: {bankConnection: true},
			});
			// Only a removal committing before the lock was taken gets here.
			if (!account?.bankConnection) throw new ConflictException(BANK_IMPORT_NOT_SAVED);
			accounts.push({account, connection: account.bankConnection, created: false});
		}
		return {accounts, fileConnection};
	}

	/**
	 * The owner's imported-files connection, created on the first import and locked for this transaction. The
	 * partial unique index makes two concurrent first imports end up with one connection; the row lock serializes
	 * imports, undo and removal of the connection.
	 */
	private async lockFileConnection(manager: EntityManager, ownerId: Account['id']): Promise<BankConnection> {
		const connections = manager.getRepository(BankConnection);
		await connections
			.createQueryBuilder()
			.insert()
			.into(BankConnection)
			.values({
				account: {id: ownerId},
				provider: BANK_CONNECTION_PROVIDERS.FILE,
				aspspName: FILE_CONNECTION_ASPSP.name,
				aspspCountry: FILE_CONNECTION_ASPSP.country,
				status: BANK_CONNECTION_STATUSES.AUTHORIZED,
				syncStatus: BANK_SYNC_STATUSES.IDLE,
				nextSyncAt: null,
				consentValidUntil: null,
				providerSessionId: null,
			})
			.orIgnore()
			.updateEntity(false)
			.execute();
		const connection = await connections.findOne({
			where: {accountId: ownerId, provider: BANK_CONNECTION_PROVIDERS.FILE},
			lock: {mode: 'pessimistic_write'},
		});
		// Only a removal committing between the two statements gets here.
		if (!connection) throw new ConflictException(BANK_IMPORT_NOT_SAVED);
		return connection;
	}

	private async findOrCreateFileAccount(
		manager: EntityManager,
		connection: BankConnection,
		rows: AccountRows,
	): Promise<ImportedAccount> {
		const bankAccounts = manager.getRepository(BankAccount);
		const {providerAccountId, hashSeed, name} = fileAccountIdentity(rows);
		const existing = await bankAccounts.findOne({where: {bankConnection: {id: connection.id}, providerAccountId}});
		if (existing) return {account: existing, connection, created: false};
		const account = await bankAccounts.save(
			bankAccounts.create({
				bankConnection: {id: connection.id},
				providerAccountId,
				identificationHash: `file:${createHash('sha256').update(hashSeed).digest('hex')}`,
				iban: rows.iban,
				name,
				currency: rows.currency,
				isActive: true,
			}),
		);
		return {account, connection, created: true};
	}

	/** The account's stored rows, any status, whose date lies within the ladder's window around the file's days. */
	private async findMatchCandidates(
		manager: EntityManager,
		bankAccountId: BankAccount['id'],
		rows: readonly NormalizedRow[],
	): Promise<MatchExistingRow[]> {
		const days = rows.flatMap((row) => {
			const day = matchDay(row);
			return day ? [day] : [];
		});
		if (days.length === 0) return [];
		days.sort();
		const existing = await manager.getRepository(BankTransaction).find({
			select: {
				id: true,
				amount: true,
				currency: true,
				bookingDate: true,
				valueDate: true,
				balanceAfterAmount: true,
				entryReference: true,
				createdAt: true,
			},
			where: {
				bankAccountId,
				bookingDate: Raw(
					(column) =>
						`COALESCE(${column}, "valueDate", "transactionDate") BETWEEN (:from)::date - ${MATCH_WINDOW_DAYS} AND (:to)::date + ${MATCH_WINDOW_DAYS}`,
					{from: days[0], to: days.at(-1)},
				),
			},
		});
		return existing.map((row) => ({
			id: row.id,
			createdAt: row.createdAt,
			amount: row.amount,
			currency: row.currency,
			bookingDate: row.bookingDate,
			valueDate: row.valueDate,
			balanceAfter: row.balanceAfterAmount,
			reference: row.entryReference,
		}));
	}

	private async findOwnedImport(ownerId: Account['id'], importId: BankImport['id']): Promise<BankImport> {
		const record = await this.dataSource
			.getRepository(BankImport)
			.findOne({where: {id: importId, accountId: ownerId, undoneAt: IsNull()}});
		if (!record) throw new NotFoundException(BANK_IMPORT_NOT_FOUND);
		return record;
	}

	/** Locks the import's connection, then the import record: the same order as an import and connection removal. */
	private async lockImport(
		manager: EntityManager,
		ownerId: Account['id'],
		owned: BankImport,
	): Promise<{connection: BankConnection; record: BankImport}> {
		const connection = await manager.getRepository(BankConnection).findOne({
			where: {id: owned.bankConnectionId, accountId: ownerId},
			lock: {mode: 'pessimistic_write'},
		});
		const record = await manager.getRepository(BankImport).findOne({
			where: {id: owned.id, accountId: ownerId, undoneAt: IsNull()},
			lock: {mode: 'pessimistic_write'},
		});
		if (!connection || !record) throw new NotFoundException(BANK_IMPORT_NOT_FOUND);
		return {connection, record};
	}

	private async findOwnedAccounts(ownerId: Account['id'], ids: readonly string[]): Promise<BankAccount[]> {
		const unique = [...new Set(ids)];
		if (unique.length === 0) return [];
		return this.dataSource.getRepository(BankAccount).find({
			where: {id: In(unique), bankConnection: {accountId: ownerId}},
			relations: {bankConnection: true},
		});
	}

	/** The steps sync runs after it persists rows, in the same order. */
	private async afterRowsChanged(ownerId: Account['id'], transactionIds: readonly string[]): Promise<void> {
		// Recompute first so new own transfers and exchanges are marked before the worker can claim them.
		await this.ownTransferService.recomputeForOwnerSafely(ownerId);
		await this.currencyExchangeService.recomputeForOwnerSafely(ownerId);
		if (transactionIds.length === 0) return;
		try {
			await this.categorizationService.enqueueForTransactions(transactionIds);
		} catch (error) {
			this.logger.warn(`Transaction categorization enqueue failed: ${safeErrorName(error)}`);
		}
		await this.merchantLogoService.enqueueForOwnerSafely(ownerId);
	}
}

/**
 * Orders statements by electronic sequence number, then first booking date, and joins each account's rows in that
 * order, per format. An account is one (IBAN, other id or bank; currency) pair.
 */
function groupByAccount(statements: readonly NormalizedStatement[]): AccountRows[] {
	const ordered = [...statements].sort(compareStatements);
	const groups = new Map<string, AccountRows>();
	for (const statement of ordered) {
		const [kind, identifier] = statement.accountIban
			? ['iban', statement.accountIban]
			: statement.accountOtherId
				? ['other', statement.accountOtherId]
				: ['bank', statement.bank as string];
		const key = JSON.stringify([kind, identifier, statement.accountCurrency]);
		const group = groups.get(key) ?? {
			identifier,
			iban: statement.accountIban,
			bank: statement.accountIban || statement.accountOtherId ? null : statement.bank,
			currency: statement.accountCurrency,
			byFormat: [],
		};
		const part = group.byFormat.find(({format}) => format === statement.format);
		if (part) part.rows.push(...statement.rows);
		else group.byFormat.push({format: statement.format, rows: [...statement.rows]});
		groups.set(key, group);
	}
	for (const group of groups.values()) {
		group.byFormat.sort((left, right) => FORMAT_ORDER.indexOf(left.format) - FORMAT_ORDER.indexOf(right.format));
	}
	return [...groups.values()];
}

function compareStatements(left: NormalizedStatement, right: NormalizedStatement): number {
	const leftSequence = sequenceOf(left);
	const rightSequence = sequenceOf(right);
	if (leftSequence !== rightSequence) {
		if (leftSequence === null) return 1;
		if (rightSequence === null) return -1;
		return leftSequence < rightSequence ? -1 : 1;
	}
	return firstBookingDate(left).localeCompare(firstBookingDate(right));
}

function sequenceOf(statement: NormalizedStatement): bigint | null {
	return statement.sequenceNumber && /^\d+$/.test(statement.sequenceNumber) ? BigInt(statement.sequenceNumber) : null;
}

function firstBookingDate(statement: NormalizedStatement): string {
	return statement.rows.find(({bookingDate}) => bookingDate)?.bookingDate ?? '9999-12-31';
}

function toTransactionInput(row: NormalizedRow, accountCurrency: string): BankTransactionInput {
	return {
		entryReference: row.bankReference ?? undefined,
		amount: row.amount,
		currency: row.currency,
		creditDebitIndicator: row.creditDebitIndicator,
		status: 'BOOK',
		transactionDate: row.transactionDate ?? undefined,
		bookingDate: row.bookingDate ?? undefined,
		valueDate: row.valueDate ?? undefined,
		description: row.description ?? undefined,
		counterpartyName: row.counterpartyName ?? undefined,
		counterpartyIban: row.counterpartyIban ?? undefined,
		remittanceInformation: row.remittanceInformation ?? undefined,
		bankTransactionCode: row.bankTransactionCode ?? undefined,
		bankTransactionSubCode: row.bankTransactionSubCode ?? undefined,
		balanceAfterAmount: row.balanceAfter ?? undefined,
		balanceAfterCurrency: row.balanceAfter ? accountCurrency : undefined,
		referenceNumber: row.referenceNumber ?? undefined,
	};
}

/** sha256 of the file, or of the sorted per-file hashes when the drop holds several files. */
function hashDrop(files: readonly Buffer[]): string {
	const hashes = files.map((file) => createHash('sha256').update(file).digest('hex'));
	if (hashes.length === 1) return hashes[0];
	return createHash('sha256').update(hashes.sort().join('\n')).digest('hex');
}

function toSummary(record: BankImport, accounts: readonly BankAccount[]): BankImportSummary {
	const accountsById = new Map(accounts.map((account) => [account.id, account]));
	return {
		id: record.id,
		format: record.format,
		filesCount: record.filesCount,
		rowsParsed: record.rowsParsed,
		rowsAdded: record.rowsAdded,
		rowsAlreadyPresent: record.rowsAlreadyPresent,
		rowsMatchedByReference: record.rowsMatchedByReference,
		rowsMatchedByBalance: record.rowsMatchedByBalance,
		rowsMatchedByDate: record.rowsMatchedByDate,
		rowsDoubtful: record.rowsDoubtful,
		dateFrom: record.dateFrom,
		dateTo: record.dateTo,
		accounts: record.bankAccountIds.flatMap((id) => {
			const account = accountsById.get(id);
			if (!account) return [];
			return [
				{
					id,
					name: account.name,
					currency: account.currency,
					created: record.createdBankAccountIds.includes(id),
				},
			];
		}),
		undoneAt: record.undoneAt?.toISOString() ?? null,
		createdAt: record.createdAt.toISOString(),
	};
}

/**
 * How an imported-files account is found again on the next drop: by its IBAN or other id and currency, or, for a
 * bank whose files name no account, by that bank and currency (one such account per currency).
 */
function fileAccountIdentity({identifier, iban, bank, currency}: AccountRows): {
	providerAccountId: string;
	hashSeed: string;
	name: string;
} {
	if (bank) {
		return {
			providerAccountId: `file-bank:${bank}:${currency}`,
			hashSeed: `bank:${bank}:${currency}`,
			name: `${bank} ${currency}`,
		};
	}
	return {
		providerAccountId: `file:${identifier}:${currency}`,
		hashSeed: `${identifier}:${currency}`,
		name: iban ? iban.replace(/(.{4})(?=.)/g, '$1 ') : identifier,
	};
}

/** The `accountChoices` key of the statements of a file that names no account. */
function accountChoiceKey(bank: StatementBank, currency: string): string {
	return `${bank}:${currency}`;
}

function toAccountCandidate(account: BankAccount): BankImportAccountCandidate {
	return {
		bankAccountId: account.id,
		name: account.name,
		currency: account.currency,
		bankName: account.bankConnection.aspspName.trim(),
		imported: account.bankConnection.provider === BANK_CONNECTION_PROVIDERS.FILE,
	};
}

function normalizeStoredIban(iban: string | null): string | null {
	return iban ? iban.replace(/\s+/g, '').toUpperCase() : null;
}

function toMatchRow(row: NormalizedRow) {
	return {
		amount: row.amount,
		currency: row.currency,
		bookingDate: row.bookingDate,
		valueDate: row.valueDate,
		balanceAfter: row.balanceAfter,
		reference: row.bankReference,
	};
}

function addLadderCounts(counts: LadderCounts, outcomes: readonly MatchOutcome[]): void {
	for (const outcome of outcomes) {
		if (outcome.kind === 'new') counts.rowsAdded += 1;
		else if (outcome.kind === 'doubtful') counts.rowsDoubtful += 1;
		else if (outcome.step === 'reference') counts.rowsMatchedByReference += 1;
		else if (outcome.step === 'balance') counts.rowsMatchedByBalance += 1;
		else counts.rowsMatchedByDate += 1;
	}
}
