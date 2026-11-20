import {BadRequestException, ConflictException, Injectable, Logger, NotFoundException} from '@nestjs/common';
import type {
	BankImportAccountCandidate,
	BankImportAccountQuestion,
	BankImportDoubtfulRow as BankImportDoubtfulRowResponse,
	BankImportFileRow,
	BankImportNeverSentKind,
	BankImportNeverSentRow,
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
	REFERENCE_FALLBACK_MIN_PROBED_ROWS_BETWEEN_FILES,
	matchDay,
	matchTransactions,
	matchWithReferenceFallback,
} from '@modules/banking/bank-transaction-matcher';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {BATCH_WRITE_CHUNK_SIZE, chunkArray, safeErrorName} from '@modules/banking/banking.utils';
import {isManualCategorySource} from '@modules/banking/categorization/bank-transaction-categorization.types';
import {isIbanIdentificationHash, verifyIbanAgainstIdentificationHash} from '@modules/banking/own-transfer/iban';
import {lockReportingCurrencyForAmountWrites} from '@modules/banking/reporting-currency';
import {
	BankTransactionInput,
	BankTransactionPersistenceService,
} from '@modules/banking/services/bank-transaction-persistence.service';
import {
	BankingConnectionLock,
	BankingConnectionLockService,
} from '@modules/banking/services/banking-connection-lock.service';
import {BANK_CONNECTION_PROVIDERS} from '@modules/banking/services/banking-sync.constants';
import {DerivedDataRefreshService} from '@modules/banking/services/derived-data-refresh.service';
import {FileAccountBalanceService} from '@modules/banking/services/file-account-balance.service';
import {fileAccountProviderId, lockFileConnection} from '@modules/banking/services/file-connection';
import {FinalSyncDays, finalSyncDays} from '@modules/banking/sync-coverage';

import {BANK_IMPORT_NEVER_SENT_ROW_KINDS, BankImportDoubtfulRow} from './bank-import-doubtful-row.entity';
import {BankImportLayoutService} from './bank-import-layout.service';
import {BankImportRefusalException} from './bank-import-refusal.exception';
import {BankImport} from './bank-import.entity';
import {ImportOutcome, decideOnFinalDays} from './never-sent-rows';
import {MAX_ROWS_PER_DROP} from './parsers/parse-limits';
import {NormalizedRow, NormalizedStatement, StatementBalance, StatementFormat} from './parsers/parse-result';
import {recordedAccounts} from './recorded-accounts';
import {ParseRunnerService} from './runner/parse-runner.service';
import {RepeatedRows, StatementGap, gapsOutsideCoverage, joinStatements} from './statement-chain';

export const BANK_IMPORT_NOT_FOUND = 'Import not found.';
export const BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND = 'Row not found.';
const BANK_IMPORT_NOT_SAVED = 'The import could not be saved. Please try again.';
const BANK_IMPORT_DOUBTFUL_ROW_RESOLVED = 'This row has already been decided.';
const BANK_IMPORT_NOT_A_CANDIDATE = 'Choose one of the transactions this row may be.';
const BANK_IMPORT_ROW_ADDED = 'One of these rows has already been added.';
/** How long an import waits for a running sync of the same connection before refusing with `account_busy`. */
const SYNC_LOCK_WAIT_MS = 10_000;
/**
 * A statement that names no account, routed by its bank to a synced account, is only checked against that account
 * when at least this many of its rows fall within the dates the account already holds; with fewer there is too little
 * to compare. A chosen value, not a measured one.
 */
export const UNCONFIRMED_TARGET_MIN_OVERLAP_ROWS = 5;
/**
 * The share of those rows the account must already hold for the statement to be its own, as numerator and
 * denominator so the check stays in integers. From a one-off check of real exports (no fixture in the repo):
 * dropped on the wrong account, under 3% of the overlapping rows matched by coincidence (equal amounts on nearby
 * days); on the right account, over 99% matched. One half sits well between them.
 */
export const UNCONFIRMED_TARGET_MIN_MATCH_SHARE = {numerator: 1, denominator: 2} as const;

/** The `accountChoices` value that sends a statement to the imported-files account of its bank and currency. */
export const ACCOUNT_CHOICE_NEW = 'new';
/** The owner's answers to `accountQuestions`: `<bank>:<currency>` to a bank account id or `new`. */
export type AccountChoices = ReadonlyMap<string, string>;
/** Where the request says a drop goes: one named account, or a choice per statement that names no account. */
export type BankImportRequest = {bankAccountId?: BankAccount['id'] | null; accountChoices?: AccountChoices};

/**
 * The statements of one account in one drop: its rows per format (a bank CSV export per layout), in matching order
 * (`FORMAT_ORDER`, then layout id), each joined in statement order (`joinStatements`).
 */
type AccountRows = {
	identifier: string;
	iban: string | null;
	/** The bank of a file that names no account (Revolut, or an owner's saved layout); null when it names one. */
	bank: string | null;
	/**
	 * For a statement that names an account: the bank of the owner's saved layout that read it, null when no saved
	 * layout did. Its IBAN then came from a column or line the model chose, so it must be confirmed like a bank.
	 */
	learnedBank: string | null;
	currency: string;
	/** `learned`: read by one of the owner's saved layouts. */
	byFormat: {
		format: StatementFormat;
		layout: string | null;
		learned: boolean;
		rows: NormalizedRow[];
		/** `rows` as listed newest first (`joinStatements`): the order new rows are stored in. */
		newestFirst: NormalizedRow[];
	}[];
	/** Rows a later statement of the same format repeats from an earlier one, left out of `byFormat`. */
	repeated: RepeatedRows;
	gaps: StatementGap[];
	/** The newest closing balance any format's statements state (`joinStatements`); the first format's on a tie. */
	closingBalance: StatementBalance | null;
};

/**
 * The order the formats of one account in one drop are matched in: each format's rows meet the rows the formats
 * before it added as if they were already stored, so one payment exported in several formats is imported once.
 */
const FORMAT_ORDER: readonly StatementFormat[] = [
	'camt053',
	'mt940',
	'abnAmroTxt',
	'revolutCsv',
	'revolutXlsx',
	'csv',
	'ofx',
];

/**
 * Where an account's rows go: an account bank sync writes to, or an imported-files account found or created.
 * `confirmed`: the statement names the synced account (its IBAN, or a bank code and account number that IBAN holds)
 * or the owner chose it, the only cases its rows may be matched without the bank's references.
 */
type Target =
	| {kind: 'synced'; account: BankAccount; confirmed: boolean}
	/**
	 * `bank`: the imported-files account of this bank and currency, for a statement whose IBAN an owner's saved layout
	 * read and the owner said is not its account.
	 */
	| {kind: 'file'; account?: BankAccount; bank?: string};

/**
 * A statement's target, and the rows the wrong-account guard compares with it: all of them for a statement found by
 * bank and currency alone, the rows an owner's saved layout read for one found by an IBAN that layout read. Null
 * when the target needs no check.
 */
type RoutedTarget = {target: Target; check: AccountRows | null};

type ImportedAccount = {account: BankAccount; connection: BankConnection; created: boolean};

/** A kind of statement file: its format, and the layout of a bank's CSV export. */
type FileKind = {format: StatementFormat; layout: string | null};

type LadderCounts = Pick<
	BankImport,
	| 'rowsAdded'
	| 'rowsMatchedByReference'
	| 'rowsMatchedByBalance'
	| 'rowsMatchedByDate'
	| 'rowsDoubtful'
	| 'rowsNotInBank'
>;

@Injectable()
export class BankImportService {
	private readonly logger = new Logger(BankImportService.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly parseRunner: ParseRunnerService,
		private readonly persistence: BankTransactionPersistenceService,
		private readonly connectionLockService: BankingConnectionLockService,
		private readonly fileAccountBalanceService: FileAccountBalanceService,
		private readonly layoutService: BankImportLayoutService,
		private readonly derivedDataRefresh: DerivedDataRefreshService,
	) {}

	/**
	 * Imports one drop, all or nothing. A statement goes to the account the request names (`bankAccountId`, or its
	 * `accountChoices` entry), else to the owner's synced account with its IBAN and currency (for a file that names no
	 * account, the one synced account at its bank in that currency, once the file's rows confirm it), or else to an
	 * imported-files account. Each row runs the duplicate ladder against the account's stored rows: matched rows are
	 * skipped, doubtful rows are held for the owner, and only new rows are inserted. On a day bank sync is final for,
	 * a row the ladder did not match is kept beside history as one the bank never sent (`not_in_bank`).
	 */
	async importFiles(
		ownerId: Account['id'],
		files: readonly Buffer[],
		{bankAccountId = null, accountChoices = new Map()}: BankImportRequest = {},
	): Promise<BankImportSummary> {
		const {statements, kinds, learnedBanks} = await this.parseDrop(ownerId, files);
		const accountRows = groupByAccount(statements, learnedBanks);
		const allRows = statements.flatMap(({rows}) => rows);
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
				await lockReportingCurrencyForAmountWrites(manager, ownerId);
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
						// A drop of one kind of file records its format and, for a bank's CSV export, its layout.
						format: kinds.size === 1 ? [...kinds.values()][0].format : 'mixed',
						layout: kinds.size === 1 ? [...kinds.values()][0].layout : null,
						filesCount: files.length,
						rowsParsed,
						rowsAdded: 0,
						rowsAlreadyPresent: 0,
						rowsMatchedByReference: 0,
						rowsMatchedByBalance: 0,
						rowsMatchedByDate: 0,
						rowsDoubtful: 0,
						rowsNotInBank: 0,
						dateFrom: bookingDates[0] ?? null,
						dateTo: bookingDates.at(-1) ?? null,
						...recordedAccounts(
							accounts.map(({account, connection, created}, index) => ({
								bankAccountId: account.id,
								created,
								fromFiles: connection.provider === BANK_CONNECTION_PROVIDERS.FILE,
								closingBalance: accountRows[index].closingBalance,
							})),
						),
						// On a synced account only the days its bank sync does not cover can be missing from Tempo.
						statementGaps: accountRows.flatMap(({gaps, currency}, index) => {
							const {account, connection} = accounts[index];
							const covered =
								connection.provider !== BANK_CONNECTION_PROVIDERS.FILE &&
								account.syncCoveredFrom &&
								account.syncCoveredThrough
									? {from: account.syncCoveredFrom, through: account.syncCoveredThrough}
									: null;
							return gapsOutsideCoverage(gaps, covered).map((gap) => ({
								bankAccountId: account.id,
								...gap,
								currency,
							}));
						}),
					}),
				);

				// Rows one statement of the drop repeats from another are already present, as on a later drop.
				const counts: LadderCounts = {
					rowsAdded: 0,
					rowsMatchedByReference: sum(accountRows.map(({repeated}) => repeated.reference)),
					rowsMatchedByBalance: sum(accountRows.map(({repeated}) => repeated.balance)),
					rowsMatchedByDate: sum(accountRows.map(({repeated}) => repeated.date)),
					rowsDoubtful: 0,
					rowsNotInBank: 0,
				};
				const persistedTransactionIds: string[] = [];
				for (const [index, {byFormat}] of accountRows.entries()) {
					const {account, connection} = accounts[index];
					const target = targets[index];
					// Without the bank's references a row of another account's statement can pass for a stored
					// payment of the same amount and day, so that path needs the statement or the owner to name it.
					const confirmed = target.kind === 'synced' && target.confirmed;
					// An imported-files account found by the IBAN a built-in reader read holds only that account's
					// files, so another format's numbering may be set aside there too, after fewer probed rows.
					const fileIbanConfirmed =
						target.kind === 'file' &&
						!target.bank &&
						!!accountRows[index].iban &&
						!accountRows[index].learnedBank;
					// Read under the sync lock, which every write of coverage and pending rows holds.
					const finalDays = await this.findFinalSyncDays(manager, account, connection);
					// Candidates are read again per format, inside the transaction, so they include the rows the
					// formats before this one just inserted. Each format numbers its rows in a scheme of its own, so
					// whether the bank's references are set aside is decided per format.
					for (const {format, layout, rows, newestFirst} of byFormat) {
						const numbering = statementNumbering(format, layout);
						const incoming = rows.map(toMatchRow);
						// Only there are imported rows told apart by numbering; elsewhere every imported row keeps its
						// references, as sync's set-aside decision rests on sync's references alone.
						const candidates = await this.findMatchCandidates(
							manager,
							account.id,
							rows,
							fileIbanConfirmed ? numbering : null,
						);
						const ladder = confirmed
							? matchWithReferenceFallback(incoming, candidates, {pairLookAlikeGroups: true})
							: fileIbanConfirmed
								? matchWithReferenceFallback(incoming, candidates, {
										pairLookAlikeGroups: true,
										minProbedRows: REFERENCE_FALLBACK_MIN_PROBED_ROWS_BETWEEN_FILES,
									})
								: {outcomes: matchTransactions(incoming, candidates), referencesSetAside: false};
						const {referencesSetAside} = ladder;
						const outcomes = decideOnFinalDays(rows, ladder.outcomes, finalDays);
						if (referencesSetAside) {
							this.logger.log(
								`Import ${record.id} matched ${rows.length} ${format} row(s) of account ${account.id} without the bank's references: none is the file's`,
							);
						}
						const newRows = new Set(rows.filter((_, rowIndex) => outcomes[rowIndex].kind === 'new'));
						if (newRows.size > 0) {
							// Stored newest first, so the transaction list shows a day's rows in that order.
							const persisted = await this.persistence.persistTransactions(
								manager.getRepository(BankTransaction),
								account,
								newestFirst
									.filter((row) => newRows.has(row))
									.map((row) => toTransactionInput(row, account.currency)),
								connection.aspspName,
								connection.provider,
								{importId: record.id, statementNumbering: numbering},
							);
							persistedTransactionIds.push(...persisted.insertedTransactionIds);
						}
						const doubtful = rows.flatMap((row, rowIndex) => {
							const outcome = outcomes[rowIndex];
							return outcome.kind === 'doubtful' || outcome.kind === 'notInBank'
								? [
										{
											importId: record.id,
											bankAccountId: account.id,
											kind:
												outcome.kind === 'doubtful'
													? ('doubtful' as const)
													: ('not_in_bank' as const),
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
				// An imported-files account's balance follows its rows; a synced account keeps the one sync reports.
				for (const {account, connection} of accounts) {
					if (connection.provider !== BANK_CONNECTION_PROVIDERS.FILE) continue;
					const balance = await this.fileAccountBalanceService.recompute(manager, ownerId, account.id);
					if (balance) Object.assign(account, balance);
				}
				Object.assign(record, counts, {
					rowsAlreadyPresent:
						counts.rowsMatchedByReference + counts.rowsMatchedByBalance + counts.rowsMatchedByDate,
				});
				await imports.update({id: record.id}, {...counts, rowsAlreadyPresent: record.rowsAlreadyPresent});
				if (counts.rowsNotInBank > 0) {
					// Counts only: a bank that keeps leaving out a kind of payment shows up here.
					this.logger.log(
						`Import ${record.id} left out ${counts.rowsNotInBank} row(s) on days bank sync is final for and never sent`,
					);
				}
				for (const lock of locks) lock.assertHealthy();
				return {record, accounts, persistedTransactionIds};
			});
		} finally {
			await this.releaseLocks(locks);
		}

		await this.derivedDataRefresh.refresh(ownerId, {
			kind: 'file-write',
			writtenIds: result.persistedTransactionIds,
		});
		return toSummary(
			result.record,
			result.accounts.map(({account, connection}) => ({...account, bankConnection: connection})),
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
					.update(
						{id: record.id},
						{undoneAt: new Date(), rowsDoubtful: 0, rowsNotInBank: 0, rowsRemovedBySync: 0},
					);
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
					// Accounts the delete just removed are skipped.
					for (const account of ownedAccounts) {
						if (account.bankConnection.id !== fileConnection.id) continue;
						await this.fileAccountBalanceService.recompute(manager, ownerId, account.id);
					}
				}
				for (const lock of locks) lock.assertHealthy();
			});
		} finally {
			await this.releaseLocks(locks);
		}

		await this.derivedDataRefresh.refresh(ownerId, {kind: 'file-write', writtenIds: []});
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
			where: {importId: record.id, kind: 'doubtful', resolution: IsNull()},
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
				importedTransactionId: doubtful.importedTransactionId,
				row: toFileRow(doubtful.row),
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
			.findOne({where: {id: rowId, importId: owned.id, kind: 'doubtful'}});
		const [account] = doubtful ? await this.findOwnedAccounts(ownerId, [doubtful.bankAccountId]) : [];
		if (!doubtful || !account?.bankConnection) throw new NotFoundException(BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND);
		const connection = account.bankConnection;
		const locks = await this.lockSyncedConnections([
			...(connection.provider === BANK_CONNECTION_PROVIDERS.FILE ? [] : [connection.id]),
			// A drop into a synced and an imported-files account is recorded under the synced connection, which
			// lockImport locks before the imported-files one: its sync lock first, as imports and undo take it.
			...(owned.bankConnectionId === connection.id ? [] : [owned.bankConnectionId]),
		]);
		let resolved: {record: BankImport; insertedTransactionIds: string[]};
		try {
			resolved = await this.dataSource.transaction(async (manager) => {
				await lockReportingCurrencyForAmountWrites(manager, ownerId);
				const {record} = await this.lockImport(manager, ownerId, owned);
				// An imported-files account's connection after the record's own, the order an import and an undo take
				// them in, so its balance is recomputed over rows and an entered balance no one else is changing.
				if (
					connection.provider === BANK_CONNECTION_PROVIDERS.FILE &&
					!(await manager.getRepository(BankConnection).findOne({
						where: {id: connection.id, accountId: ownerId},
						lock: {mode: 'pessimistic_write'},
					}))
				) {
					throw new NotFoundException(BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND);
				}
				const rows = manager.getRepository(BankImportDoubtfulRow);
				const current = await rows.findOne({where: {id: doubtful.id}, lock: {mode: 'pessimistic_write'}});
				if (!current) throw new NotFoundException(BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND);
				if (current.resolution) throw new ConflictException(BANK_IMPORT_DOUBTFUL_ROW_RESOLVED);

				let resolvedTransactionId: string;
				const insertedTransactionIds: string[] = [];
				if (current.importedTransactionId) {
					await this.resolveImportedRowQuestion(manager, record, current, request);
					for (const lock of locks) lock.assertHealthy();
					return {record, insertedTransactionIds};
				}
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
						{importId: record.id, statementNumbering: importNumbering(record)},
					);
					insertedTransactionIds.push(...persisted.insertedTransactionIds);
					resolvedTransactionId = persisted.insertedTransactionIds[0];
					record.rowsAdded += 1;
					// Does nothing for a synced account.
					await this.fileAccountBalanceService.recompute(manager, ownerId, account.id);
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

		await this.derivedDataRefresh.refresh(ownerId, {
			kind: 'file-write',
			writtenIds: resolved.insertedTransactionIds,
		});
		return toSummary(resolved.record, await this.findOwnedAccounts(ownerId, resolved.record.bankAccountIds));
	}

	/**
	 * The import's rows on days bank sync is final for that it never sent, not added (`not_in_bank`) or removed by a
	 * later sync (`removed_by_sync`), that the owner has not added, in booking order.
	 */
	async findNeverSentRows(ownerId: Account['id'], importId: BankImport['id']): Promise<BankImportNeverSentRow[]> {
		const record = await this.dataSource
			.getRepository(BankImport)
			.findOne({where: {id: importId, accountId: ownerId}});
		if (!record) throw new NotFoundException(BANK_IMPORT_NOT_FOUND);
		const rows = await this.dataSource.getRepository(BankImportDoubtfulRow).find({
			where: {importId: record.id, kind: In([...BANK_IMPORT_NEVER_SENT_ROW_KINDS]), resolution: IsNull()},
			order: {id: 'ASC'},
		});
		return rows
			.map(({id, kind, bankAccountId, row}) => ({
				id,
				kind: kind as BankImportNeverSentKind,
				bankAccountId,
				row: toFileRow(row),
			}))
			.sort((left, right) => (matchDay(left.row) ?? '').localeCompare(matchDay(right.row) ?? ''));
	}

	/**
	 * Adds never-sent rows the owner chose as rows of the import, all or none, each resolved `new` with the row it
	 * became, which bank sync never removes. A row a sync removed gets back its manual category and own-transfer
	 * choice. A row is added once: any already added refuses the whole request.
	 */
	async addNeverSentRows(
		ownerId: Account['id'],
		importId: BankImport['id'],
		rowIds: readonly string[],
	): Promise<BankImportSummary> {
		const owned = await this.findOwnedImport(ownerId, importId);
		const ids = [...new Set(rowIds)];
		const found = await this.dataSource.getRepository(BankImportDoubtfulRow).find({
			select: {id: true, bankAccountId: true},
			where: {id: In(ids), importId: owned.id, kind: In([...BANK_IMPORT_NEVER_SENT_ROW_KINDS])},
		});
		if (found.length !== ids.length) throw new NotFoundException(BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND);
		const accounts = await this.findOwnedAccounts(
			ownerId,
			found.map(({bankAccountId}) => bankAccountId),
		);
		const accountsById = new Map(accounts.map((account) => [account.id, account]));
		if (found.some(({bankAccountId}) => !accountsById.get(bankAccountId)?.bankConnection)) {
			throw new NotFoundException(BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND);
		}
		// An owner has one imported-files connection.
		const fileConnectionId = accounts.find(
			({bankConnection}) => bankConnection.provider === BANK_CONNECTION_PROVIDERS.FILE,
		)?.bankConnection.id;
		const locks = await this.lockSyncedConnections([
			...accounts.flatMap(({bankConnection}) =>
				bankConnection.provider === BANK_CONNECTION_PROVIDERS.FILE ? [] : [bankConnection.id],
			),
			// An account its bank's removal kept is on the imported-files connection while the record may still hang on
			// a synced one: that one's sync lock first, as imports and undo take it.
			...(fileConnectionId && owned.bankConnectionId !== fileConnectionId ? [owned.bankConnectionId] : []),
		]);
		let added: {record: BankImport; insertedTransactionIds: string[]};
		try {
			added = await this.dataSource.transaction(async (manager) => {
				await lockReportingCurrencyForAmountWrites(manager, ownerId);
				const {record} = await this.lockImport(manager, ownerId, owned);
				// The imported-files connection after the record's own, the order an import and an undo take them in, so
				// a kept account's balance is recomputed over rows and an entered balance no one else is changing.
				if (
					fileConnectionId &&
					fileConnectionId !== record.bankConnectionId &&
					!(await manager.getRepository(BankConnection).findOne({
						where: {id: fileConnectionId, accountId: ownerId},
						lock: {mode: 'pessimistic_write'},
					}))
				) {
					throw new NotFoundException(BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND);
				}
				// A removal or an authorization that moved an account after it was read committed before its sync lock
				// was free: the locks taken are not that account's, so the add is refused as busy.
				const moved = await manager.getRepository(BankAccount).count({
					where: accounts.map(({id, bankConnection}) => ({
						id,
						bankConnection: {id: Not(bankConnection.id), accountId: ownerId},
					})),
				});
				if (moved > 0) throw new BankImportRefusalException('account_busy');
				const rows = manager.getRepository(BankImportDoubtfulRow);
				const current = await rows.find({
					where: {id: In(ids), importId: record.id, kind: In([...BANK_IMPORT_NEVER_SENT_ROW_KINDS])},
					order: {id: 'ASC'},
					lock: {mode: 'pessimistic_write'},
				});
				if (current.length !== ids.length) throw new NotFoundException(BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND);
				if (current.some(({resolution}) => resolution)) throw new ConflictException(BANK_IMPORT_ROW_ADDED);
				const insertedTransactionIds: string[] = [];
				for (const row of current) {
					const account = accountsById.get(row.bankAccountId)!;
					// One row per call, so each never-sent row records the transaction it became.
					const persisted = await this.persistence.persistTransactions(
						manager.getRepository(BankTransaction),
						account,
						[toTransactionInput(row.row, account.currency)],
						account.bankConnection.aspspName,
						account.bankConnection.provider,
						{importId: record.id, statementNumbering: importNumbering(record)},
					);
					const [transactionId] = persisted.insertedTransactionIds;
					insertedTransactionIds.push(transactionId);
					if (row.ownerEdits) {
						await this.persistence.applyOwnerEdits(
							manager.getRepository(BankTransaction),
							transactionId,
							row.ownerEdits,
							account.bankConnection.aspspName,
						);
					}
					await rows.update({id: row.id}, {resolution: 'new', resolvedTransactionId: transactionId});
				}
				// Does nothing for a synced account.
				for (const bankAccountId of new Set(current.map(({bankAccountId}) => bankAccountId))) {
					await this.fileAccountBalanceService.recompute(manager, ownerId, bankAccountId);
				}
				const removedBySync = current.filter(({kind}) => kind === 'removed_by_sync').length;
				record.rowsAdded += current.length;
				record.rowsNotInBank -= current.length - removedBySync;
				record.rowsRemovedBySync -= removedBySync;
				await manager.getRepository(BankImport).update(
					{id: record.id},
					{
						rowsAdded: record.rowsAdded,
						rowsNotInBank: record.rowsNotInBank,
						rowsRemovedBySync: record.rowsRemovedBySync,
					},
				);
				for (const lock of locks) lock.assertHealthy();
				return {record, insertedTransactionIds};
			});
		} finally {
			await this.releaseLocks(locks);
		}

		await this.derivedDataRefresh.refresh(ownerId, {kind: 'file-write', writtenIds: added.insertedTransactionIds});
		return toSummary(added.record, await this.findOwnedAccounts(ownerId, added.record.bankAccountIds));
	}

	/**
	 * The days bank sync is final for on the account (`finalSyncDays`): none for an imported-files account, or one
	 * without complete coverage. Pending rows end them, since sync reads again from the oldest one.
	 */
	private async findFinalSyncDays(
		manager: EntityManager,
		account: BankAccount,
		connection: BankConnection,
	): Promise<FinalSyncDays | null> {
		if (!account.syncCoveredFrom || !account.syncCoveredThrough) return null;
		const pendingStarts = await this.persistence.findPendingTransactionStarts(
			manager.getRepository(BankTransaction),
			[account.id],
		);
		return finalSyncDays({
			provider: connection.provider,
			syncCoveredFrom: account.syncCoveredFrom,
			syncCoveredThrough: account.syncCoveredThrough,
			oldestPendingDay: pendingStarts.get(account.id) ?? null,
		});
	}

	/**
	 * Parses every file in request order, with the owner's saved layouts after the built-in readers; the first refusal
	 * names its file and nothing is written. `kinds` holds each kind of file read once: its format, and its layout when
	 * it is a bank's CSV export or an owner's layout.
	 */
	private async parseDrop(
		ownerId: Account['id'],
		files: readonly Buffer[],
	): Promise<{
		statements: NormalizedStatement[];
		kinds: Map<string, FileKind>;
		learnedBanks: ReadonlyMap<string, string>;
	}> {
		const owned = await this.layoutService.ownedLayouts(ownerId);
		const learnedBanks = new Map(owned.map(({id, bank}) => [id, bank]));
		const statements: NormalizedStatement[] = [];
		const kinds = new Map<string, FileKind>();
		const seen = new Set<string>();
		let rows = 0;
		for (const [index, file] of files.entries()) {
			const outcome = await this.parseRunner.parse(file, owned);
			if (!outcome.ok) {
				// Counted by code and the layout a near miss names; never anything of the file.
				this.logger.log(`Bank import refused: ${outcome.code}${outcome.layout ? ` (${outcome.layout})` : ''}`);
				throw new BankImportRefusalException(outcome.code, index + 1, undefined, outcome.layout);
			}
			const {formats, layouts} = outcome.result;
			for (const format of formats.filter((format) => format !== 'csv'))
				kinds.set(format, {format, layout: null});
			for (const layout of layouts) kinds.set(`csv:${layout}`, {format: 'csv', layout});
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
		return {statements, kinds, learnedBanks};
	}

	/**
	 * The target of each statement of a request that names no single account. A statement with an `accountChoices`
	 * entry goes where the owner chose. The others go to the synced account with their IBAN and currency (stored IBAN,
	 * or the identification hash); for one named by a bank code and account number (`bankCodeAndAccount`), the synced
	 * account in its currency whose IBAN holds them; for a file that names no account, the synced account in its
	 * currency at a connection of its bank, an active one when any fits. Otherwise an imported-files account.
	 *
	 * Refuses, listing every statement that needs an answer: `ambiguous_target_account` when two synced accounts fit
	 * a statement, else `target_account_unconfirmed` when a statement routed by its bank alone, by a bank code and
	 * account number, or by an IBAN an owner's saved layout read, is not confirmed by the account's stored rows
	 * (`isTargetConfirmed`). Such a statement the owner answered `new` for before goes to that imported-files account
	 * instead, once its rows confirm it.
	 */
	private async findRoutedTargets(
		ownerId: Account['id'],
		accountRows: readonly AccountRows[],
		accountChoices: AccountChoices,
	): Promise<Target[]> {
		const syncedAccounts = accountRows.some((rows) => rows.iban || rows.bank || bankCodeAndAccount(rows))
			? await this.dataSource.getRepository(BankAccount).find({
					where: {bankConnection: {accountId: ownerId, provider: Not(BANK_CONNECTION_PROVIDERS.FILE)}},
					relations: {bankConnection: true},
					order: {id: 'ASC'},
				})
			: [];
		// The synced accounts whose IBAN holds the bank code and account number a statement names its account by.
		const holders = accountRows.map((rows) => {
			const parts = bankCodeAndAccount(rows);
			return parts
				? syncedAccounts.filter(({iban, currency}) => currency === rows.currency && ibanHolds(iban, parts))
				: [];
		});
		const banks = askedBanks(accountRows, holders.map(holdersBank));
		const keys = accountRows.map(({currency}, index) =>
			banks[index] ? accountChoiceKey(banks[index], currency) : null,
		);
		for (const key of accountChoices.keys()) {
			if (!keys.includes(key)) throw new BankImportRefusalException('target_account_mismatch');
		}
		const routed: Array<RoutedTarget | null> = [];
		const ambiguous: Array<{index: number; matches: BankAccount[]}> = [];
		for (const [index, rows] of accountRows.entries()) {
			const choice = keys[index] === null ? undefined : accountChoices.get(keys[index]);
			if (choice !== undefined) {
				routed.push({target: await this.findChosenTarget(ownerId, choice, rows, banks[index]!), check: null});
				continue;
			}
			const {iban, bank, currency} = rows;
			const fitting =
				iban || bank
					? syncedAccounts.filter(
							(account) =>
								account.currency === currency &&
								(iban
									? normalizeStoredIban(account.iban) === iban ||
										verifyIbanAgainstIdentificationHash(account.identificationHash, iban, currency)
									: account.bankConnection.aspspName.trim().toLowerCase() === bank!.toLowerCase()),
						)
					: holders[index];
			// Without an IBAN, an account bank sync no longer reports (closed, or left out of the consent) fits only when
			// no active one does, so it cannot make the statement of an active account ambiguous.
			const active = iban ? [] : fitting.filter(({isActive}) => isActive);
			const matches = active.length > 0 ? active : fitting;
			if (matches.length > 1) {
				ambiguous.push({index, matches});
				routed.push(null);
			} else if (iban && rows.learnedBank) {
				// The IBAN came from a column or line the model chose, so the account it names, synced or imported,
				// must hold the rows the saved layout read, as an account found by bank alone must.
				const account = matches[0] ?? (await this.findFileAccount(ownerId, rows));
				routed.push({
					target: matches[0]
						? {kind: 'synced', account: matches[0], confirmed: true}
						: {kind: 'file', ...(account ? {account} : {})},
					check: account ? learnedPart(rows) : null,
				});
			} else {
				// A file that names no account names none, so only the owner's choice confirms it.
				routed.push({
					target:
						matches.length === 1 ? {kind: 'synced', account: matches[0], confirmed: !bank} : {kind: 'file'},
					check: !iban && matches.length === 1 ? rows : null,
				});
			}
		}

		// Read without the sync lock: this only decides whether to ask the owner, and the ladder runs again under it.
		const unconfirmed: number[] = [];
		for (const [index, entry] of routed.entries()) {
			if (!entry?.check || !entry.target.account) continue;
			if (await this.isTargetConfirmed(ownerId, entry.target.account, entry.check)) continue;
			// The owner already said such a statement is not the account its IBAN or account number found: it goes where
			// that answer put it, once that account's rows confirm it.
			const rows = accountRows[index];
			const bank = banks[index];
			const answered = !rows.bank && bank && (await this.findFileAccount(ownerId, newAccountRows(rows, bank)));
			if (answered && (await this.isTargetConfirmed(ownerId, answered, entry.check))) {
				routed[index] = {target: {kind: 'file', account: answered}, check: null};
				continue;
			}
			unconfirmed.push(index);
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
					// The account the statement would have gone to first, then every other active account in its currency.
					candidates: [
						routedTo,
						...ownedAccounts.filter(
							({id, currency, isActive}) =>
								isActive && id !== routedTo.id && currency === accountRows[index].currency,
						),
					],
				});
			}
		}
		const asked = questions
			.filter(({index}) => banks[index])
			.sort((left, right) => left.index - right.index)
			.map(({index, candidates}) => ({
				rows: accountRows[index],
				bank: banks[index]!,
				providerAccountId: fileAccountIdentity(newAccountRows(accountRows[index], banks[index]!))
					.providerAccountId,
				candidates,
			}));
		// `new` goes to the imported-files account of the bank and currency once it exists, so it is offered as itself.
		const fileAccounts =
			asked.length > 0
				? await this.dataSource.getRepository(BankAccount).find({
						where: {
							bankConnection: {accountId: ownerId, provider: BANK_CONNECTION_PROVIDERS.FILE},
							providerAccountId: In(asked.map(({providerAccountId}) => providerAccountId)),
						},
						relations: {bankConnection: true},
					})
				: [];
		throw new BankImportRefusalException(
			ambiguous.length > 0 ? 'ambiguous_target_account' : 'target_account_unconfirmed',
			null,
			asked.map(({rows, bank, providerAccountId, candidates}) => {
				const fileAccount = fileAccounts.find((account) => account.providerAccountId === providerAccountId);
				const unlisted = fileAccount && !candidates.some(({id}) => id === fileAccount.id);
				return {
					bank,
					currency: rows.currency,
					candidates: (unlisted ? [...candidates, fileAccount] : candidates).map(toAccountCandidate),
					newAccount: !fileAccount,
				};
			}) satisfies BankImportAccountQuestion[],
		);
	}

	/** The owner's `accountChoices` answer for a statement that names no account: any account of theirs in its currency. */
	private async findChosenTarget(
		ownerId: Account['id'],
		choice: string,
		rows: AccountRows,
		bank: string,
	): Promise<Target> {
		// `new` for a statement whose IBAN a saved layout read: the owner says that IBAN is not its account.
		if (choice === ACCOUNT_CHOICE_NEW) return rows.iban ? {kind: 'file', bank} : {kind: 'file'};
		const [account] = await this.findOwnedAccounts(ownerId, [choice]);
		if (!account?.bankConnection || account.currency !== rows.currency) {
			throw new BankImportRefusalException('target_account_mismatch');
		}
		// Nothing in the statement confirms the account chosen; the owner's choice does.
		return account.bankConnection.provider === BANK_CONNECTION_PROVIDERS.FILE
			? {kind: 'file', account}
			: {kind: 'synced', account, confirmed: true};
	}

	/**
	 * Whether a statement found only by its bank and currency, by a bank code and account number, or by an IBAN an
	 * owner's saved layout read, looks like the account's own history. It takes
	 * the format with the most rows within the first and last day the account stores (on a tie, the earlier in
	 * `FORMAT_ORDER`). With fewer than `UNCONFIRMED_TARGET_MIN_OVERLAP_ROWS` such rows, including a statement entirely
	 * outside the stored dates, it is confirmed: there is too little to compare it with. Otherwise it is confirmed
	 * only when the ladder matches at least `UNCONFIRMED_TARGET_MIN_MATCH_SHARE` of those rows against the stored
	 * rows. A doubtful row is no match. A statement named by a bank code and account number carries the bank's
	 * references in its own numbering, so its ladder is the reference fallback the import then runs.
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
		// `byFormat` is in `FORMAT_ORDER`, so keeping only a strictly larger overlap breaks ties to the earlier format.
		let largest: {rows: NormalizedRow[]; inRange: number[]} | null = null;
		for (const {rows: formatRows} of rows.byFormat) {
			const inRange = formatRows.flatMap((row, index) => {
				const day = matchDay(row);
				return day && day >= from && day <= to ? [index] : [];
			});
			if (inRange.length > (largest?.inRange.length ?? 0)) largest = {rows: formatRows, inRange};
		}
		if (!largest || largest.inRange.length < UNCONFIRMED_TARGET_MIN_OVERLAP_ROWS) return true;
		const incoming = largest.rows.map(toMatchRow);
		const candidates = await this.findMatchCandidates(this.dataSource.manager, account.id, largest.rows);
		const outcomes = bankCodeAndAccount(rows)
			? matchWithReferenceFallback(incoming, candidates, {pairLookAlikeGroups: true}).outcomes
			: matchTransactions(incoming, candidates);
		const matched = largest.inRange.filter((index) => outcomes[index].kind === 'matched').length;
		const {numerator, denominator} = UNCONFIRMED_TARGET_MIN_MATCH_SHARE;
		return matched * denominator >= largest.inRange.length * numerator;
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
		// The owner named the account, and nothing in the statement contradicts it.
		return {kind: 'synced', account, confirmed: true};
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
				const rows = target.bank ? withoutAccount(accountRows[index], target.bank) : accountRows[index];
				accounts.push(await this.findOrCreateFileAccount(manager, fileConnection!, rows));
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

	/** The owner's imported-files connection (`lockFileConnection`), locked for this transaction. */
	private async lockFileConnection(manager: EntityManager, ownerId: Account['id']): Promise<BankConnection> {
		const connection = await lockFileConnection(manager, ownerId);
		// Only a removal committing between creating and locking it gets here.
		if (!connection) throw new ConflictException(BANK_IMPORT_NOT_SAVED);
		return connection;
	}

	/** The owner's imported-files account the rows would go to, if it exists already. */
	private async findFileAccount(ownerId: Account['id'], rows: AccountRows): Promise<BankAccount | null> {
		return this.dataSource.getRepository(BankAccount).findOne({
			where: {
				bankConnection: {accountId: ownerId, provider: BANK_CONNECTION_PROVIDERS.FILE},
				providerAccountId: fileAccountIdentity(rows).providerAccountId,
			},
			relations: {bankConnection: true},
		});
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

	/**
	 * The account's stored rows, any status, whose date lies within the ladder's window around the file's days.
	 * `numbering`: the incoming rows' (`statementNumbering`), or null to count every imported row as the same
	 * numbering. With one, an imported row of another recorded numbering is not; a row stored before numberings were
	 * recorded still is, so its reference conflicts.
	 */
	private async findMatchCandidates(
		manager: EntityManager,
		bankAccountId: BankAccount['id'],
		rows: readonly NormalizedRow[],
		numbering: string | null = null,
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
				counterpartyName: true,
				description: true,
				createdAt: true,
				importId: true,
				statementNumbering: true,
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
			text: matchText(row.counterpartyName, row.description),
			amount: row.amount,
			currency: row.currency,
			bookingDate: row.bookingDate,
			valueDate: row.valueDate,
			balanceAfter: row.balanceAfterAmount,
			reference: row.entryReference,
			source: row.importId,
			sameNumbering:
				row.importId !== null &&
				(numbering === null || row.statementNumbering === null || row.statementNumbering === numbering),
		}));
	}

	/**
	 * Answers a question a sync raised about one of the import's rows already in history. `duplicate`: the row is the
	 * chosen synced candidate, so it is deleted after its manual category and own-transfer choice move to the
	 * candidate where the candidate has none of its own. `new`: both are payments of their own and stay.
	 */
	private async resolveImportedRowQuestion(
		manager: EntityManager,
		record: BankImport,
		question: BankImportDoubtfulRow,
		request: ResolveBankImportDoubtfulRowRequest,
	): Promise<void> {
		const transactions = manager.getRepository(BankTransaction);
		// Only a row the import still owns is ever removed; a row bank sync took over is the bank's.
		// Locked, so an edit saved on it meanwhile either lands before its choices move or finds it gone.
		const imported = await transactions.findOne({
			where: {id: question.importedTransactionId!, bankAccountId: question.bankAccountId, importId: record.id},
			lock: {mode: 'pessimistic_write'},
		});
		if (!imported) throw new NotFoundException(BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND);
		let resolvedTransactionId = imported.id;
		if (request.decision === 'duplicate') {
			const candidate =
				request.transactionId && question.candidateTransactionIds.includes(request.transactionId)
					? await transactions.findOne({
							where: {id: request.transactionId, bankAccountId: question.bankAccountId},
							relations: {bankAccount: {bankConnection: true}},
						})
					: null;
			if (!candidate) throw new BadRequestException(BANK_IMPORT_NOT_A_CANDIDATE);
			// Each choice moves only where the synced row has none at the moment of the write, so an owner's choice
			// saved on it meanwhile is kept.
			await this.persistence.applyOwnerEdits(
				transactions,
				candidate.id,
				{
					category: isManualCategorySource(imported.categorySource) ? imported.category : null,
					ownTransferOverride: imported.ownTransferOverride,
				},
				candidate.bankAccount?.bankConnection?.aspspName,
			);
			resolvedTransactionId = candidate.id;
			record.rowsAdded -= 1;
			record.rowsAlreadyPresent += 1;
		}
		record.rowsDoubtful -= 1;
		// The question keeps its answer; it stops pointing at the imported row before that row goes.
		await manager.getRepository(BankImportDoubtfulRow).update(
			{id: question.id},
			{
				resolution: request.decision,
				resolvedTransactionId,
				importedTransactionId: request.decision === 'duplicate' ? null : imported.id,
			},
		);
		if (request.decision === 'duplicate') await transactions.delete({id: imported.id, importId: record.id});
		await manager.getRepository(BankImport).update(
			{id: record.id},
			{
				rowsAdded: record.rowsAdded,
				rowsAlreadyPresent: record.rowsAlreadyPresent,
				rowsDoubtful: record.rowsDoubtful,
			},
		);
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
}

/**
 * Orders statements by electronic sequence number, then first booking date, and joins each account's statements in
 * that order, per format (`joinStatements`). An account is one (IBAN, other id or bank; currency) pair.
 * `learnedBanks`: the bank of each of the owner's saved layouts, by layout id.
 */
function groupByAccount(
	statements: readonly NormalizedStatement[],
	learnedBanks: ReadonlyMap<string, string>,
): AccountRows[] {
	const ordered = [...statements].sort(compareStatements);
	const groups = new Map<
		string,
		Omit<AccountRows, 'byFormat' | 'repeated' | 'gaps' | 'closingBalance'> & {
			parts: {
				format: StatementFormat;
				layout: string | null;
				learned: boolean;
				statements: NormalizedStatement[];
			}[];
		}
	>();
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
			learnedBank: null,
			currency: statement.accountCurrency,
			parts: [],
		};
		const learnedBank = (statement.layout && learnedBanks.get(statement.layout)) ?? null;
		if (statement.accountIban) group.learnedBank ??= learnedBank;
		// Exports of one bank in two CSV layouts (such as two languages) are two formats to each other.
		const part = group.parts.find(({format, layout}) => format === statement.format && layout === statement.layout);
		if (part) part.statements.push(statement);
		else {
			group.parts.push({
				format: statement.format,
				layout: statement.layout,
				learned: learnedBank !== null,
				statements: [statement],
			});
		}
		groups.set(key, group);
	}
	return [...groups.values()].map(({parts, ...account}) => {
		parts.sort(
			(left, right) =>
				FORMAT_ORDER.indexOf(left.format) - FORMAT_ORDER.indexOf(right.format) ||
				(left.layout ?? '').localeCompare(right.layout ?? ''),
		);
		const joined = parts.map(({statements: partStatements}) => joinStatements(partStatements));
		return {
			...account,
			byFormat: parts.map(({format, layout, learned}, index) => ({
				format,
				layout,
				learned,
				rows: joined[index].rows,
				newestFirst: joined[index].newestFirst,
			})),
			repeated: {
				reference: sum(joined.map(({repeated}) => repeated.reference)),
				balance: sum(joined.map(({repeated}) => repeated.balance)),
				date: sum(joined.map(({repeated}) => repeated.date)),
			},
			gaps: joined.flatMap(({gaps}) => gaps),
			closingBalance: joined.reduce<StatementBalance | null>(
				(newest, {closingBalance}) =>
					closingBalance && (!newest || closingBalance.date > newest.date) ? closingBalance : newest,
				null,
			),
		};
	});
}

function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
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
	// Balances and the balance trend go by booking date, so an entry without one takes its value date, else its
	// transaction date, and says so, as bank sync does.
	const bookingDate = row.bookingDate ?? row.valueDate ?? row.transactionDate;
	return {
		entryReference: row.bankReference ?? undefined,
		amount: row.amount,
		currency: row.currency,
		creditDebitIndicator: row.creditDebitIndicator,
		status: 'BOOK',
		transactionDate: row.transactionDate ?? undefined,
		bookingDate: bookingDate ?? undefined,
		...(!row.bookingDate && bookingDate ? {bookingDateFilled: true} : {}),
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
	// Imports recorded before an account was recorded once per drop can name it twice.
	const accountIds = [...new Set(record.bankAccountIds)];
	return {
		id: record.id,
		format: record.format,
		layout: record.layout,
		filesCount: record.filesCount,
		rowsParsed: record.rowsParsed,
		rowsAdded: record.rowsAdded,
		rowsAlreadyPresent: record.rowsAlreadyPresent,
		rowsMatchedByReference: record.rowsMatchedByReference,
		rowsMatchedByBalance: record.rowsMatchedByBalance,
		rowsMatchedByDate: record.rowsMatchedByDate,
		rowsDoubtful: record.rowsDoubtful,
		rowsNotInBank: record.rowsNotInBank,
		rowsRemovedBySync: record.rowsRemovedBySync,
		dateFrom: record.dateFrom,
		dateTo: record.dateTo,
		accounts: accountIds.flatMap((id) => {
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
		accountsWithoutBalance: record.undoneAt
			? []
			: accountIds.flatMap((id) => {
					const account = accountsById.get(id);
					if (
						!account ||
						account.bankConnection?.provider !== BANK_CONNECTION_PROVIDERS.FILE ||
						account.currentBalanceAmount !== null
					) {
						return [];
					}
					return [{id, name: account.name, currency: account.currency}];
				}),
		statementGaps: record.statementGaps,
		undoneAt: record.undoneAt?.toISOString() ?? null,
		createdAt: record.createdAt.toISOString(),
	};
}

/** The scheme a statement numbers its rows in: its format, and the layout of a CSV-style file. */
function statementNumbering(format: StatementFormat, layout: string | null): string {
	return layout ? `${format}:${layout}` : format;
}

/** The numbering of an import's rows, unknown for a drop of several formats or layouts. */
function importNumbering({format, layout}: BankImport): string | null {
	return format === 'mixed' ? null : statementNumbering(format, layout);
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
		providerAccountId: fileAccountProviderId(identifier, currency),
		hashSeed: `${identifier}:${currency}`,
		name: iban ? iban.replace(/(.{4})(?=.)/g, '$1 ') : identifier,
	};
}

/**
 * The bank the owner is asked about each statement under: the bank of a file that names no account; of the saved
 * layout that read every part of a statement's IBAN; or, for a statement named by a bank code and account number, of
 * the synced accounts whose IBAN holds them (`holderBanks`). The last two only when no other statement of the drop
 * has that bank and currency (an answer under a shared one would move them all). Null when the owner cannot be asked
 * about it.
 */
function askedBanks(
	accountRows: readonly AccountRows[],
	holderBanks: ReadonlyArray<string | null>,
): Array<string | null> {
	const banks = accountRows.map(
		(rows, index) =>
			rows.bank ??
			(rows.learnedBank && rows.byFormat.every(({learned}) => learned) ? rows.learnedBank : null) ??
			holderBanks[index],
	);
	const key = (index: number) => banks[index] && accountChoiceKey(banks[index], accountRows[index].currency);
	// Such a statement is then refused without a question, and an earlier `new` answer is not looked up for it either:
	// the owner drops its files one at a time.
	return banks.map((bank, index) =>
		!accountRows[index].bank && accountRows.some((_, other) => other !== index && key(other) === key(index))
			? null
			: bank,
	);
}

/** The bank of the synced accounts holding a statement's account number, when they are at one bank. */
function holdersBank(holders: readonly BankAccount[]): string | null {
	const names = [...new Set(holders.map(({bankConnection}) => bankConnection.aspspName.trim()))];
	return names.length === 1 ? names[0] : null;
}

/**
 * The parts of an account id that is no IBAN, when it gives at least a bank code and an account number (OFX
 * `BANKID`, `BRANCHID` and `ACCTID`; an MT940 bank code and account number such as `BLZ/Kontonummer`), upper-cased;
 * null for any other statement.
 */
function bankCodeAndAccount(rows: AccountRows): string[] | null {
	if (rows.iban || rows.bank) return null;
	const parts = rows.identifier
		.toUpperCase()
		.split(/[^A-Z0-9]+/)
		.filter(Boolean);
	return parts.length >= 2 ? parts : null;
}

/**
 * Whether an IBAN's national part starts with the bank code (after the letters some countries put first) and holds
 * the other parts after it in order, each with or without leading zeros. This is how IBANs embed the national bank
 * code and account number (DE `BLZ` and `Kontonummer`, FR bank, branch and account, UK bank and sort code).
 */
function ibanHolds(iban: string | null, parts: readonly string[]): boolean {
	const normalized = normalizeStoredIban(iban);
	if (!normalized) return false;
	const pattern = parts.map((part) => `0*${part.replace(/^0+(?=.)/, '')}`).join('[A-Z0-9]*?');
	return new RegExp(`^[A-Z]*${pattern}`).test(normalized.slice(4));
}

/** The parts of the rows the owner's saved layouts read. */
function learnedPart(rows: AccountRows): AccountRows {
	return {...rows, byFormat: rows.byFormat.filter(({learned}) => learned)};
}

/** The rows as a statement of the bank that names no account. */
function withoutAccount(rows: AccountRows, bank: string): AccountRows {
	return {...rows, identifier: bank, iban: null, bank, learnedBank: null};
}

/** The rows as the account the owner's answer `new` under `bank` creates for them. */
function newAccountRows(rows: AccountRows, bank: string): AccountRows {
	return rows.iban ? withoutAccount(rows, bank) : rows;
}

/** The `accountChoices` key of the statements of a file that names no account. */
function accountChoiceKey(bank: string, currency: string): string {
	return `${bank}:${currency}`;
}

function toAccountCandidate(account: BankAccount): BankImportAccountCandidate {
	return {
		bankAccountId: account.id,
		name: account.name,
		details: account.details,
		alias: account.alias,
		cashAccountType: account.cashAccountType,
		maskedIdentifier: account.maskedIdentifier,
		currency: account.currency,
		bankName: account.bankConnection.aspspName.trim(),
		imported: account.bankConnection.provider === BANK_CONNECTION_PROVIDERS.FILE,
	};
}

function normalizeStoredIban(iban: string | null): string | null {
	return iban ? iban.replace(/\s+/g, '').toUpperCase() : null;
}

function toFileRow(row: NormalizedRow): BankImportFileRow {
	return {
		bookingDate: row.bookingDate,
		valueDate: row.valueDate,
		amount: row.amount,
		currency: row.currency,
		balanceAfter: row.balanceAfter,
		bankReference: row.bankReference,
		counterpartyName: row.counterpartyName,
		description: row.description,
		remittanceInformation: row.remittanceInformation,
	};
}

function toMatchRow(row: NormalizedRow) {
	return {
		text: matchText(row.counterpartyName, row.description),
		amount: row.amount,
		currency: row.currency,
		bookingDate: row.bookingDate,
		valueDate: row.valueDate,
		balanceAfter: row.balanceAfter,
		reference: row.bankReference,
	};
}

/** What look-alike pairing compares, as sync builds it: counterparty and description. */
function matchText(counterpartyName: string | null, description: string | null): string | null {
	return [counterpartyName, description].filter(Boolean).join(' ') || null;
}

function addLadderCounts(counts: LadderCounts, outcomes: readonly ImportOutcome[]): void {
	for (const outcome of outcomes) {
		if (outcome.kind === 'new') counts.rowsAdded += 1;
		else if (outcome.kind === 'doubtful') counts.rowsDoubtful += 1;
		else if (outcome.kind === 'notInBank') counts.rowsNotInBank += 1;
		else if (outcome.step === 'reference') counts.rowsMatchedByReference += 1;
		else if (outcome.step === 'balance') counts.rowsMatchedByBalance += 1;
		else counts.rowsMatchedByDate += 1;
	}
}
