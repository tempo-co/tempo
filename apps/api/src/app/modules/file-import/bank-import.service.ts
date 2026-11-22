import {BadRequestException, ConflictException, Injectable, Logger, NotFoundException} from '@nestjs/common';
import type {
	BankImportAccountCandidate,
	BankImportAccountQuestion,
	BankImportDoubtfulRow as BankImportDoubtfulRowResponse,
	BankImportFileRow,
	BankImportLayoutPreview,
	BankImportNeverSentKind,
	BankImportNeverSentRow,
	BankImportSummary,
	ResolveBankImportDoubtfulRowRequest,
} from '@tempo/contracts';
import {bankNameKey} from '@tempo/contracts';
import {createHash} from 'node:crypto';
import {DataSource, EntityManager, In, IsNull, Not, Raw} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {
	BankIdentity,
	bicBankIdentity,
	differentBanks,
	nameBankIdentity,
	strongerBankIdentity,
} from '@modules/banking/bank-identity';
import {
	MATCH_WINDOW_DAYS,
	MatchExistingRow,
	REFERENCE_FALLBACK_MIN_PROBED_ROWS_BETWEEN_FILES,
	matchDay,
	matchTransactions,
	matchWithReferenceFallback,
} from '@modules/banking/bank-transaction-matcher';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {BATCH_WRITE_CHUNK_SIZE, chunkArray} from '@modules/banking/banking.utils';
import {isManualCategorySource} from '@modules/banking/categorization/bank-transaction-categorization.types';
import {AccountHistoryWriteBusyError} from '@modules/banking/errors/account-history-write-busy.error';
import {isIbanIdentificationHash, verifyIbanAgainstIdentificationHash} from '@modules/banking/own-transfer/iban';
import {
	AccountHistoryWrite,
	AccountHistoryWriteLocks,
	AccountHistoryWriterService,
} from '@modules/banking/services/account-history-writer.service';
import {
	BankTransactionInput,
	BankTransactionPersistenceService,
} from '@modules/banking/services/bank-transaction-persistence.service';
import {BANK_CONNECTION_PROVIDERS} from '@modules/banking/services/banking-sync.constants';
import {DerivedDataRefreshService} from '@modules/banking/services/derived-data-refresh.service';
import {FileAccountBalanceService} from '@modules/banking/services/file-account-balance.service';
import {fileAccountProviderId} from '@modules/banking/services/file-connection';

import {BANK_IMPORT_NEVER_SENT_ROW_KINDS, BankImportDoubtfulRow} from './bank-import-doubtful-row.entity';
import {BankImportLayoutService, previewOfRows, previewRow} from './bank-import-layout.service';
import {BankImportRefusalException} from './bank-import-refusal.exception';
import {BankImport} from './bank-import.entity';
import {ImportOutcome, decideOnFinalDays} from './never-sent-rows';
import type {CsvLayout} from './parsers/csv-layout';
import {CSV_LAYOUTS} from './parsers/csv-layouts';
import {MAX_ROWS_PER_DROP} from './parsers/parse-limits';
import {
	FORMAT_BANKS,
	NormalizedRow,
	NormalizedStatement,
	StatementBalance,
	StatementFormat,
} from './parsers/parse-result';
import {recordedAccounts} from './recorded-accounts';
import {ParseRunnerService} from './runner/parse-runner.service';
import {RepeatedRows, StatementGap, gapsOutsideCoverage, joinStatements} from './statement-chain';

export const BANK_IMPORT_NOT_FOUND = 'Import not found.';
export const BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND = 'Row not found.';
const BANK_IMPORT_NOT_SAVED = 'The import could not be saved. Please try again.';
const BANK_IMPORT_DOUBTFUL_ROW_RESOLVED = 'This row has already been decided.';
const BANK_IMPORT_NOT_A_CANDIDATE = 'Choose one of the transactions this row may be.';
const BANK_IMPORT_ROW_ADDED = 'One of these rows has already been added.';
/** How the identification hash of an account made from files starts. */
const FILE_IDENTIFICATION_PREFIX = 'file:';
/** An account question's preview of a headerless layout's rows: the first 2 of each file, at most 10 in all. */
const PREVIEW_ROWS_PER_FILE = 2;
const MAX_PREVIEW_ROWS = 10;
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
	/**
	 * Each piece of bank evidence its statements give (`statementBankIdentity`), with the 1-based file of the first
	 * statement giving it; never part of the account key. For an
	 * account named by an id that is no IBAN, checked against the bank the stored account records, then against each
	 * other (`refuseBankConflicts`).
	 */
	bankEvidence: Array<{identity: BankIdentity; file: number}>;
	currency: string;
	/** `learned`: read by one of the owner's saved layouts. */
	byFormat: {
		format: StatementFormat;
		layout: string | null;
		learned: boolean;
		rows: NormalizedRow[];
		/** `rows` as listed newest first (`joinStatements`): the order new rows are stored in. */
		newestFirst: NormalizedRow[];
		/** The rows of each of the part's statements (each file a layout read, also inside an archive), in order. */
		byStatement: NormalizedRow[][];
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
		private readonly accountHistoryWriter: AccountHistoryWriterService,
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
		const {statements, evidenceFiles, kinds, learnedBanks, headerlessLayouts} = await this.parseDrop(
			ownerId,
			files,
		);
		const accountRows = groupByAccount(statements, learnedBanks, evidenceFiles);
		const allRows = statements.flatMap(({rows}) => rows);
		const bookingDates = allRows.flatMap(({bookingDate}) => (bookingDate ? [bookingDate] : [])).sort();
		const rowsParsed = allRows.length;
		const targets = bankAccountId
			? [await this.findNamedTarget(ownerId, bankAccountId, accountRows)]
			: await this.findRoutedTargets(ownerId, accountRows, accountChoices, headerlessLayouts);

		const syncedConnectionIds = [
			...new Set(
				targets.flatMap((target) => (target.kind === 'synced' ? [target.account.bankConnection.id] : [])),
			),
		];
		// The record hangs on one connection and goes with it, so a drop may write to one synced connection at most.
		if (syncedConnectionIds.length > 1) throw new BankImportRefusalException('multiple_bank_connections');

		// A drop without a synced target (even one without accounts) is recorded under the imported-files connection.
		const toFiles = targets.length === 0 || targets.some(({kind}) => kind === 'file');
		const result = await this.write(
			ownerId,
			{syncedConnectionIds, ...(toFiles ? {fileConnection: 'create'} : {})},
			async (write) => {
				const {manager, fileConnection} = write;
				if (toFiles && !fileConnection) throw new ConflictException(BANK_IMPORT_NOT_SAVED);
				const accounts = await this.resolveTargets(manager, ownerId, accountRows, targets, fileConnection);
				const accountStatements = accounts.map((imported, index) => ({
					...imported,
					rows: placedEvidence(accountRows[index], imported.account, headerlessLayouts),
				}));
				refuseBankConflicts(accountStatements);
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

				await recordBankIdentities(manager, ownerId, accountStatements);

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
				// Two statements of a drop (an export naming the account and one naming only its bank) can reach one
				// account: its rows are added in one write to it, statement by statement in drop order.
				const statementsByAccount = new Map<string, number[]>();
				for (const [index, {account}] of accounts.entries()) {
					statementsByAccount.set(account.id, [...(statementsByAccount.get(account.id) ?? []), index]);
				}
				for (const indexes of statementsByAccount.values()) {
					const {account, connection} = accounts[indexes[0]];
					// Final days are read under the sync lock, which every write of coverage and pending rows holds.
					const added = await this.accountHistoryWriter.addFileRows(
						write,
						{account, connection, importId: record.id},
						async ({finalDays, insert}) => {
							for (const index of indexes) {
								const target = targets[index];
								// Without the bank's references a row of another account's statement can pass for a
								// stored payment of the same amount and day, so that path needs the statement or the
								// owner to name it.
								const confirmed = target.kind === 'synced' && target.confirmed;
								// An imported-files account found by the IBAN a built-in reader read holds only that
								// account's files, so another format's numbering may be set aside there too, after fewer
								// probed rows.
								const fileIbanConfirmed =
									target.kind === 'file' &&
									!target.bank &&
									!!accountRows[index].iban &&
									!accountRows[index].learnedBank;
								// Candidates are read again per format, inside the transaction, so they include the rows
								// the formats and statements before this one just inserted. Each format numbers its rows in
								// a scheme of its own, so whether the bank's references are set aside is decided per format.
								for (const {format, layout, rows, newestFirst} of accountRows[index].byFormat) {
									const numbering = statementNumbering(format, layout);
									const incoming = rows.map(toMatchRow);
									// Only there are imported rows told apart by numbering; elsewhere every imported row
									// keeps its references, as sync's set-aside decision rests on sync's references alone.
									const candidates = await this.findMatchCandidates(
										manager,
										ownerId,
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
											: {
													outcomes: matchTransactions(incoming, candidates),
													referencesSetAside: false,
												};
									const {referencesSetAside} = ladder;
									const outcomes = decideOnFinalDays(rows, ladder.outcomes, finalDays);
									if (referencesSetAside) {
										this.logger.log(
											`Import ${record.id} matched ${rows.length} ${format} row(s) of account ${account.id} without the bank's references: none is the file's`,
										);
									}
									const newRows = new Set(
										rows.filter((_, rowIndex) => outcomes[rowIndex].kind === 'new'),
									);
									if (newRows.size > 0) {
										// Stored newest first, so the transaction list shows a day's rows in that order.
										await insert(
											newestFirst
												.filter((row) => newRows.has(row))
												.map((row) => toTransactionInput(row, account.currency)),
											{statementNumbering: numbering},
										);
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
						},
					);
					persistedTransactionIds.push(...added.change.writtenIds);
					if (added.balance)
						for (const index of indexes) Object.assign(accounts[index].account, added.balance);
				}
				Object.assign(record, counts, {
					rowsAlreadyPresent:
						counts.rowsMatchedByReference + counts.rowsMatchedByBalance + counts.rowsMatchedByDate,
				});
				await imports.update(
					{id: record.id, accountId: ownerId},
					{...counts, rowsAlreadyPresent: record.rowsAlreadyPresent},
				);
				if (counts.rowsNotInBank > 0) {
					// Counts only: a bank that keeps leaving out a kind of payment shows up here.
					this.logger.log(
						`Import ${record.id} left out ${counts.rowsNotInBank} row(s) on days bank sync is final for and never sent`,
					);
				}
				return {record, accounts, persistedTransactionIds};
			},
		);

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
		const recordedUnderFiles = await this.isRecordedUnderFiles(ownerId, owned);
		await this.write(
			ownerId,
			{
				syncedConnectionIds: [
					...ownedAccounts.flatMap((account) =>
						account.bankConnection.provider === BANK_CONNECTION_PROVIDERS.FILE
							? []
							: [account.bankConnection.id],
					),
					...recordSyncLease(owned, recordedUnderFiles),
				],
				...(fileConnectionId || recordedUnderFiles ? {fileConnection: 'existing'} : {}),
			},
			async (write) => {
				const {manager, fileConnection: lockedFileConnection} = write;
				const fileConnection = lockedFileConnection?.id === fileConnectionId ? lockedFileConnection : null;
				const {record} = await this.lockImport(write, ownerId, owned, recordedUnderFiles);
				await refuseMovedAccounts(manager, ownerId, ownedAccounts);
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
						{id: record.id, accountId: ownerId},
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
			},
		);

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
		const addedSince = await findAddedSince(this.dataSource.manager, ownerId, rows);
		const candidateIds = [...new Set(rows.flatMap((doubtful) => candidateIdsOf(doubtful, addedSince)))];
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
				candidates: candidateIdsOf(doubtful, addedSince).flatMap((id) => {
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
		const toFiles = connection.provider === BANK_CONNECTION_PROVIDERS.FILE;
		const recordedUnderFiles = await this.isRecordedUnderFiles(ownerId, owned);
		const resolved = await this.write(
			ownerId,
			{
				syncedConnectionIds: [
					...(toFiles ? [] : [connection.id]),
					...recordSyncLease(owned, recordedUnderFiles),
				],
				// An imported-files account's connection, so its balance is recomputed over rows and an entered
				// balance no one else is changing; or the record's own (`lockImport`).
				...(toFiles || recordedUnderFiles ? {fileConnection: 'existing'} : {}),
			},
			async (write) => {
				const {manager, fileConnection} = write;
				const {record} = await this.lockImport(write, ownerId, owned, recordedUnderFiles);
				if (toFiles && fileConnection?.id !== connection.id) {
					throw new NotFoundException(BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND);
				}
				await refuseMovedAccounts(manager, ownerId, [account]);
				const rows = manager.getRepository(BankImportDoubtfulRow);
				const current = await rows.findOne({where: {id: doubtful.id}, lock: {mode: 'pessimistic_write'}});
				if (!current) throw new NotFoundException(BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND);
				if (current.resolution) throw new ConflictException(BANK_IMPORT_DOUBTFUL_ROW_RESOLVED);

				let resolvedTransactionId: string;
				const insertedTransactionIds: string[] = [];
				if (current.importedTransactionId) {
					await this.resolveImportedRowQuestion(manager, ownerId, record, current, request);
					return {record, insertedTransactionIds};
				}
				if (request.decision === 'duplicate') {
					const transactionId = request.transactionId;
					const addedSince = await findAddedSince(manager, ownerId, [current]);
					const candidate =
						transactionId && candidateIdsOf(current, addedSince).includes(transactionId)
							? await manager.getRepository(BankTransaction).findOne({
									select: {id: true},
									where: {
										id: transactionId,
										bankAccountId: current.bankAccountId,
										bankAccount: {bankConnection: {accountId: ownerId}},
									},
								})
							: null;
					if (!candidate) throw new BadRequestException(BANK_IMPORT_NOT_A_CANDIDATE);
					resolvedTransactionId = candidate.id;
					record.rowsAlreadyPresent += 1;
				} else {
					const added = await this.accountHistoryWriter.addFileRows(
						write,
						{account, connection, importId: record.id},
						({insert}) =>
							insert([toTransactionInput(current.row, account.currency)], {
								statementNumbering: importNumbering(record),
							}),
						// The owner's answer adds the row even on a day bank sync became final for since.
						{onFinalDays: 'add'},
					);
					insertedTransactionIds.push(...added.change.writtenIds);
					resolvedTransactionId = added.result[0];
					record.rowsAdded += 1;
				}
				record.rowsDoubtful -= 1;
				await rows.update({id: current.id}, {resolution: request.decision, resolvedTransactionId});
				await manager.getRepository(BankImport).update(
					{id: record.id, accountId: ownerId},
					{
						rowsAdded: record.rowsAdded,
						rowsAlreadyPresent: record.rowsAlreadyPresent,
						rowsDoubtful: record.rowsDoubtful,
					},
				);
				return {record, insertedTransactionIds};
			},
		);

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
		const recordedUnderFiles = await this.isRecordedUnderFiles(ownerId, owned);
		const added = await this.write(
			ownerId,
			{
				syncedConnectionIds: [
					...accounts.flatMap(({bankConnection}) =>
						bankConnection.provider === BANK_CONNECTION_PROVIDERS.FILE ? [] : [bankConnection.id],
					),
					...recordSyncLease(owned, recordedUnderFiles),
				],
				// So a kept account's balance is recomputed over rows and an entered balance no one else is changing;
				// or the record's own (`lockImport`).
				...(fileConnectionId || recordedUnderFiles ? {fileConnection: 'existing'} : {}),
			},
			async (write) => {
				const {manager, fileConnection} = write;
				const {record} = await this.lockImport(write, ownerId, owned, recordedUnderFiles);
				if (fileConnectionId && fileConnection?.id !== fileConnectionId) {
					throw new NotFoundException(BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND);
				}
				await refuseMovedAccounts(manager, ownerId, accounts);
				const rows = manager.getRepository(BankImportDoubtfulRow);
				const current = await rows.find({
					where: {id: In(ids), importId: record.id, kind: In([...BANK_IMPORT_NEVER_SENT_ROW_KINDS])},
					order: {id: 'ASC'},
					lock: {mode: 'pessimistic_write'},
				});
				if (current.length !== ids.length) throw new NotFoundException(BANK_IMPORT_DOUBTFUL_ROW_NOT_FOUND);
				if (current.some(({resolution}) => resolution)) throw new ConflictException(BANK_IMPORT_ROW_ADDED);
				const insertedTransactionIds: string[] = [];
				for (const bankAccountId of new Set(current.map(({bankAccountId}) => bankAccountId))) {
					const account = accountsById.get(bankAccountId)!;
					const accountRows = current.filter((row) => row.bankAccountId === bankAccountId);
					const added = await this.accountHistoryWriter.addFileRows(
						write,
						{account, connection: account.bankConnection, importId: record.id},
						async ({insert}) => {
							for (const row of accountRows) {
								// One row per insert, so each never-sent row records the transaction it became.
								const [transactionId] = await insert([toTransactionInput(row.row, account.currency)], {
									statementNumbering: importNumbering(record),
								});
								if (row.ownerEdits) {
									await this.persistence.applyOwnerEdits(
										manager.getRepository(BankTransaction),
										ownerId,
										transactionId,
										row.ownerEdits,
										account.bankConnection.aspspName,
									);
								}
								await manager.query(
									`UPDATE "bank_import_doubtful_rows" doubtful
									SET "resolution" = 'new', "resolvedTransactionId" = $2, "updatedAt" = now()
									FROM "bank_imports" bank_import
									WHERE doubtful."id" = $1
										AND bank_import."id" = doubtful."importId" AND bank_import."accountId" = $3`,
									[row.id, transactionId, ownerId],
								);
							}
						},
						// Never-sent rows are on final days: the owner chose to add them all the same.
						{onFinalDays: 'add'},
					);
					insertedTransactionIds.push(...added.change.writtenIds);
				}
				const removedBySync = current.filter(({kind}) => kind === 'removed_by_sync').length;
				record.rowsAdded += current.length;
				record.rowsNotInBank -= current.length - removedBySync;
				record.rowsRemovedBySync -= removedBySync;
				await manager.getRepository(BankImport).update(
					{id: record.id, accountId: ownerId},
					{
						rowsAdded: record.rowsAdded,
						rowsNotInBank: record.rowsNotInBank,
						rowsRemovedBySync: record.rowsRemovedBySync,
					},
				);
				return {record, insertedTransactionIds};
			},
		);

		await this.derivedDataRefresh.refresh(ownerId, {kind: 'file-write', writtenIds: added.insertedTransactionIds});
		return toSummary(added.record, await this.findOwnedAccounts(ownerId, added.record.bankAccountIds));
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
		/** The 1-based file each statement's bank evidence came from: its own, or the copy that stated its BIC. */
		evidenceFiles: ReadonlyMap<NormalizedStatement, number>;
		kinds: Map<string, FileKind>;
		learnedBanks: ReadonlyMap<string, string>;
		/** The owner's saved layouts with no header that name no account (`unnamedHeaderlessLayout`), by id. */
		headerlessLayouts: ReadonlySet<string>;
	}> {
		const owned = await this.layoutService.ownedLayouts(ownerId);
		const learnedBanks = new Map(owned.map(({id, bank}) => [id, bank]));
		const headerlessLayouts = new Set(owned.filter(unnamedHeaderlessLayout).map(({id}) => id));
		const statements: NormalizedStatement[] = [];
		const kinds = new Map<string, FileKind>();
		const seen = new Map<string, NormalizedStatement[]>();
		const evidenceFiles = new Map<NormalizedStatement, number>();
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
				// A statement dropped twice in one go (an archive and its own files) is the same statement, also when only
				// one copy states its bank's BIC. Copies naming two BICs for an id that is no IBAN are two banks'
				// statements, which `groupByAccount` refuses.
				const key = JSON.stringify({...statement, servicerBic: null});
				const copies = seen.get(key) ?? [];
				const copy = copies.find(
					({servicerBic}) =>
						statement.accountIban !== null ||
						servicerBic === null ||
						statement.servicerBic === null ||
						servicerBic === statement.servicerBic,
				);
				if (copy) {
					if (copy.servicerBic === null && statement.servicerBic !== null) {
						copy.servicerBic = statement.servicerBic;
						evidenceFiles.set(copy, index + 1);
					}
					continue;
				}
				seen.set(key, [...copies, statement]);
				evidenceFiles.set(statement, index + 1);
				rows += statement.rows.length;
				if (rows > MAX_ROWS_PER_DROP) throw new BankImportRefusalException('too_many_rows', index + 1);
				statements.push(statement);
			}
		}
		return {statements, evidenceFiles, kinds, learnedBanks, headerlessLayouts};
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
	 * instead, once its rows confirm it. A statement one of the `headerlessLayouts` read is never confirmed by its rows:
	 * without an `accountChoices` answer it is always asked about.
	 */
	private async findRoutedTargets(
		ownerId: Account['id'],
		accountRows: readonly AccountRows[],
		accountChoices: AccountChoices,
		headerlessLayouts: ReadonlySet<string>,
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
		/** The accounts of its bank that fit a statement asked about for a headerless layout, inactive ones too. */
		const fittingByIndex = new Map<number, BankAccount[]>();
		// Another bank's export of the same columns reads with such a layout, so only the owner places its rows.
		const askOwner = accountRows.map(
			(rows, index) => !accountChoices.has(keys[index] ?? '') && readByHeaderlessLayout(rows, headerlessLayouts),
		);
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
									: bankNameKey(account.bankConnection.aspspName) === bankNameKey(bank!)),
						)
					: holders[index];
			// Without an IBAN, an account bank sync no longer reports (closed, or left out of the consent) fits only when
			// no active one does, so it cannot make the statement of an active account ambiguous.
			const active = iban ? [] : fitting.filter(({isActive}) => isActive);
			const matches = active.length > 0 ? active : fitting;
			if (matches.length > 1 && askOwner[index]) {
				// Asked about with these and every active account in its currency, as nothing shows it is this bank's.
				fittingByIndex.set(index, matches);
				routed.push({target: {kind: 'file'}, check: null});
			} else if (matches.length > 1) {
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
			if (entry && askOwner[index]) {
				unconfirmed.push(index);
				continue;
			}
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
				// Only a statement of a headerless layout may be asked about with no account routed to yet.
				const routedTo = routed[index]!.target.account;
				// The account the statement would have gone to first (or those of its bank that fit), then every other
				// active account in its currency.
				const first = routedTo ? [routedTo] : (fittingByIndex.get(index) ?? []);
				questions.push({
					index,
					candidates: [
						...first,
						...ownedAccounts.filter(
							({id, currency, isActive}) =>
								isActive &&
								!first.some((account) => account.id === id) &&
								currency === accountRows[index].currency,
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
				candidates,
				layoutPreview: askOwner[index] ? headerlessLayoutPreview(accountRows[index], headerlessLayouts) : null,
			}));
		// `new` goes to the imported-files account of the bank and currency once it exists, so it is offered as itself.
		const fileAccounts = await Promise.all(
			asked.map(({rows, bank}) => this.findFileAccount(ownerId, newAccountRows(rows, bank))),
		);
		throw new BankImportRefusalException(
			ambiguous.length > 0 ? 'ambiguous_target_account' : 'target_account_unconfirmed',
			null,
			asked.map(({rows, bank, candidates, layoutPreview}, askedIndex) => {
				const fileAccount = fileAccounts[askedIndex];
				const unlisted = fileAccount && !candidates.some(({id}) => id === fileAccount.id);
				return {
					bank,
					currency: rows.currency,
					candidates: (unlisted ? [...candidates, fileAccount] : candidates).map(toAccountCandidate),
					newAccount: !fileAccount,
					layoutPreview,
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
		const candidates = await this.findMatchCandidates(this.dataSource.manager, ownerId, account.id, largest.rows);
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
			if (!bank && (await this.findFileAccount(ownerId, accountRows[0]))?.id !== account.id) {
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

	/** Opens a write to the owner's history (`AccountHistoryWriterService`); a sync holding a lease refuses it as busy. */
	private async write<T>(
		ownerId: Account['id'],
		locks: AccountHistoryWriteLocks,
		work: (write: AccountHistoryWrite) => Promise<T>,
	): Promise<T> {
		try {
			return await this.accountHistoryWriter.write(ownerId, locks, work);
		} catch (error) {
			if (error instanceof AccountHistoryWriteBusyError) throw new BankImportRefusalException('account_busy');
			throw error;
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
		/** The owner's locked imported-files connection, when a target is an imported-files account. */
		fileConnection: BankConnection | null,
	): Promise<ImportedAccount[]> {
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
		return accounts;
	}

	/** The owner's imported-files account the rows would go to, if it exists already (`findFileAccountIn`). */
	private async findFileAccount(ownerId: Account['id'], rows: AccountRows): Promise<BankAccount | null> {
		const {account} = await findFileAccountIn(this.dataSource.manager, ownerId, null, rows);
		return account;
	}

	/** The imported-files account the rows go to (`findFileAccountIn`), created when it does not exist yet. */
	private async findOrCreateFileAccount(
		manager: EntityManager,
		connection: BankConnection,
		rows: AccountRows,
	): Promise<ImportedAccount> {
		const bankAccounts = manager.getRepository(BankAccount);
		const {account: existing, identity} = await findFileAccountIn(
			manager,
			connection.accountId,
			connection.id,
			rows,
		);
		if (existing) return {account: existing, connection, created: false};
		const account = await bankAccounts.save(
			bankAccounts.create({
				bankConnection: {id: connection.id},
				providerAccountId: identity.providerAccountId,
				identificationHash: `${FILE_IDENTIFICATION_PREFIX}${createHash('sha256').update(identity.hashSeed).digest('hex')}`,
				iban: rows.iban,
				name: identity.name,
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
		ownerId: Account['id'],
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
				bankAccount: {bankConnection: {accountId: ownerId}},
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
		ownerId: Account['id'],
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
							where: {
								id: request.transactionId,
								bankAccountId: question.bankAccountId,
								bankAccount: {bankConnection: {accountId: ownerId}},
							},
							relations: {bankAccount: {bankConnection: true}},
						})
					: null;
			if (!candidate) throw new BadRequestException(BANK_IMPORT_NOT_A_CANDIDATE);
			// Each choice moves only where the synced row has none at the moment of the write, so an owner's choice
			// saved on it meanwhile is kept.
			await this.persistence.applyOwnerEdits(
				transactions,
				ownerId,
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
			{id: record.id, accountId: ownerId},
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

	/**
	 * Whether the import is recorded under the owner's imported-files connection, which its write then asks the writer
	 * to lock, so only the writer takes that lock.
	 */
	private async isRecordedUnderFiles(ownerId: Account['id'], owned: BankImport): Promise<boolean> {
		return this.dataSource.getRepository(BankConnection).exists({
			where: {id: owned.bankConnectionId, accountId: ownerId, provider: BANK_CONNECTION_PROVIDERS.FILE},
		});
	}

	/**
	 * Locks the import's connection, then the import record: the same order as an import and connection removal. A
	 * record under the imported-files connection has that lock from the writer (`fileConnection`), which takes it for
	 * the write; one under a synced connection locks that connection here.
	 */
	private async lockImport(
		{manager, fileConnection}: AccountHistoryWrite,
		ownerId: Account['id'],
		owned: BankImport,
		recordedUnderFiles: boolean,
	): Promise<{record: BankImport}> {
		const connection = recordedUnderFiles
			? fileConnection?.id === owned.bankConnectionId
				? fileConnection
				: null
			: await manager.getRepository(BankConnection).findOne({
					where: {id: owned.bankConnectionId, accountId: ownerId},
					lock: {mode: 'pessimistic_write'},
				});
		const record = await manager.getRepository(BankImport).findOne({
			where: {id: owned.id, accountId: ownerId, undoneAt: IsNull()},
			lock: {mode: 'pessimistic_write'},
		});
		if (!connection || !record) throw new NotFoundException(BANK_IMPORT_NOT_FOUND);
		return {record};
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
 * Rows another import added to each held-out doubtful row's account since the question was asked, on its day with its
 * amount and currency: a re-dropped file's answer `new` may have stored the very payment this question is about.
 * Oldest first. Rows of the question's own import are other payments of the same file.
 */
async function findAddedSince(
	manager: EntityManager,
	ownerId: Account['id'],
	doubtfulRows: readonly BankImportDoubtfulRow[],
): Promise<Map<BankImportDoubtfulRow['id'], string[]>> {
	const heldOut = doubtfulRows.filter(({importedTransactionId}) => !importedTransactionId);
	if (!heldOut.length) return new Map();
	const found: Array<{doubtfulId: string; transactionId: string}> = await manager.query(
		`SELECT doubtful."id" AS "doubtfulId", bank_transaction."id" AS "transactionId"
		FROM "bank_import_doubtful_rows" doubtful
		JOIN "bank_transactions" bank_transaction
			ON bank_transaction."bankAccountId" = doubtful."bankAccountId"
			AND bank_transaction."importId" IS NOT NULL
			AND bank_transaction."importId" <> doubtful."importId"
			AND bank_transaction."createdAt" > doubtful."createdAt"
			AND bank_transaction."amount" = (doubtful."row"->>'amount')::numeric
			AND bank_transaction."currency" = doubtful."row"->>'currency'
			AND bank_transaction."bookingDate" = COALESCE(doubtful."row"->>'bookingDate', doubtful."row"->>'valueDate')::date
		JOIN "bank_accounts" bank_account ON bank_account."id" = bank_transaction."bankAccountId"
		JOIN "bank_connections" connection
			ON connection."id" = bank_account."bankConnectionId" AND connection."accountId" = $2
		WHERE doubtful."id" = ANY($1::uuid[])
		ORDER BY bank_transaction."createdAt", bank_transaction."id"`,
		[heldOut.map(({id}) => id), ownerId],
	);
	const byDoubtful = new Map<string, string[]>();
	for (const {doubtfulId, transactionId} of found) {
		byDoubtful.set(doubtfulId, [...(byDoubtful.get(doubtfulId) ?? []), transactionId]);
	}
	return byDoubtful;
}

/** The question's candidates: those the ladder found, then rows added since (`findAddedSince`). */
function candidateIdsOf(
	doubtful: BankImportDoubtfulRow,
	addedSince: ReadonlyMap<BankImportDoubtfulRow['id'], string[]>,
): string[] {
	return [...new Set([...doubtful.candidateTransactionIds, ...(addedSince.get(doubtful.id) ?? [])])];
}

/**
 * The sync lease of the synced connection the import is recorded under, which a write to it takes as imports do: a
 * drop into a synced and an imported-files account is recorded under the synced connection, which may then be none of
 * the write's accounts' (an account its bank's removal kept, or one an authorization took back to another bank).
 */
function recordSyncLease(owned: BankImport, recordedUnderFiles: boolean): BankConnection['id'][] {
	return recordedUnderFiles ? [] : [owned.bankConnectionId];
}

/**
 * Refuses a write as busy when a removal or an authorization moved any of its accounts to another connection after
 * the write read them: that change committed before the locks were free, so the locks the write took, chosen by the
 * accounts' old connections, are not theirs. The client retries, and the retry asks for the right locks.
 */
async function refuseMovedAccounts(
	manager: EntityManager,
	ownerId: Account['id'],
	accounts: readonly BankAccount[],
): Promise<void> {
	if (accounts.length === 0) return;
	const moved = await manager.getRepository(BankAccount).count({
		where: accounts.map(({id, bankConnection}) => ({
			id,
			bankConnection: {id: Not(bankConnection.id), accountId: ownerId},
		})),
	});
	if (moved > 0) throw new BankImportRefusalException('account_busy');
}

/**
 * Orders statements by electronic sequence number, then first booking date, and joins each account's statements in
 * that order, per format (`joinStatements`). An account is one (IBAN, other id or bank; currency) pair.
 * `learnedBanks`: the bank of each of the owner's saved layouts, by layout id.
 */
function groupByAccount(
	statements: readonly NormalizedStatement[],
	learnedBanks: ReadonlyMap<string, string>,
	evidenceFiles: ReadonlyMap<NormalizedStatement, number>,
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
			bankEvidence: [],
			currency: statement.accountCurrency,
			parts: [],
		};
		const identity = statementBankIdentity(statement, learnedBanks);
		if (identity && !group.bankEvidence.some((known) => known.identity === identity)) {
			group.bankEvidence.push({identity, file: evidenceFiles.get(statement)!});
		}
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
				byStatement: parts[index].statements.map((statement) => statement.rows),
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

/** An account an import writes to, with the statements' rows it takes. */
type AccountStatements = ImportedAccount & {rows: AccountRows};

/**
 * Refuses the drop with `account_bank_conflict` when statements naming an account by an id that is no IBAN give
 * evidence of two banks of the same kind (`differentBanks`): the same id at another bank, which Tempo cannot tell
 * apart. A statement disagreeing with the bank the imported-files account records is named first, then a later
 * statement disagreeing with an earlier one of the drop.
 */
function refuseBankConflicts(statementsByAccount: readonly AccountStatements[]): void {
	const local = statementsByAccount.filter(({rows}) => !rows.iban && !rows.bank);
	for (const {account, connection, rows} of local) {
		if (connection.provider !== BANK_CONNECTION_PROVIDERS.FILE) continue;
		const conflict = rows.bankEvidence.find(({identity}) => differentBanks(account.bankIdentity, identity));
		if (conflict) throw new BankImportRefusalException('account_bank_conflict', conflict.file);
	}
	for (const {rows} of local) {
		const conflict = rows.bankEvidence.find(({identity}, index) =>
			rows.bankEvidence.slice(0, index).some((known) => differentBanks(known.identity, identity)),
		);
		if (conflict) throw new BankImportRefusalException('account_bank_conflict', conflict.file);
	}
}

/**
 * Gives each account made from files that has no bank the strongest evidence of all the drop's statements routed to
 * it (`strongerBankIdentity`), written once per account inside the import's transaction. A bank once given stays while
 * the account has rows; it goes with the account when an undo leaves it none. An account kept from a bank connection
 * (its bank's hash, not a file one) keeps its connection's bank.
 */
async function recordBankIdentities(
	manager: EntityManager,
	ownerId: Account['id'],
	statementsByAccount: readonly AccountStatements[],
): Promise<void> {
	const evidence = new Map<BankAccount['id'], BankIdentity>();
	for (const {account, rows} of statementsByAccount) {
		if (account.bankIdentity || !account.identificationHash.startsWith(FILE_IDENTIFICATION_PREFIX)) continue;
		for (const {identity} of rows.bankEvidence) {
			evidence.set(account.id, strongerBankIdentity(evidence.get(account.id) ?? null, identity)!);
		}
	}
	for (const [accountId, identity] of evidence) {
		await manager.query(
			`UPDATE "bank_accounts" SET "bankIdentity" = $3
			WHERE "id" = $1
				AND "bankConnectionId" IN (SELECT "id" FROM "bank_connections" WHERE "accountId" = $2 AND "provider" = $4)`,
			[accountId, ownerId, identity, BANK_CONNECTION_PROVIDERS.FILE],
		);
	}
	// Two statement groups of the drop can hold two copies of one account.
	for (const {account} of statementsByAccount) {
		account.bankIdentity = evidence.get(account.id) ?? account.bankIdentity;
	}
}

/**
 * The owner's imported-files account the rows go to, if it exists, and the identity it has or gets
 * (`fileAccountIdentity`). Rows of a file that names no account go to the account of their bank, named ignoring case
 * and spacing, and currency; rows named by an IBAN or other id to the account of that id and currency.
 * `connectionId`: the owner's imported-files connection, when known.
 */
async function findFileAccountIn(
	manager: EntityManager,
	ownerId: Account['id'],
	connectionId: BankConnection['id'] | null,
	rows: AccountRows,
): Promise<{account: BankAccount | null; identity: FileAccountIdentity}> {
	const accounts = await manager.getRepository(BankAccount).find({
		where: {
			bankConnection: {
				...(connectionId ? {id: connectionId} : {}),
				accountId: ownerId,
				provider: BANK_CONNECTION_PROVIDERS.FILE,
			},
			currency: rows.currency,
		},
		relations: {bankConnection: true},
		order: {id: 'ASC'},
	});
	const identity = fileAccountIdentity(rows);
	if (rows.bank) {
		const bank = rows.bank;
		const ofBank = accounts.filter(({providerAccountId}) =>
			fileBankAccountOf(providerAccountId, bank, rows.currency),
		);
		return {
			account:
				ofBank.find(({providerAccountId}) => providerAccountId === identity.providerAccountId) ??
				ofBank[0] ??
				null,
			identity,
		};
	}
	return {
		account: accounts.find(({providerAccountId}) => providerAccountId === identity.providerAccountId) ?? null,
		identity,
	};
}

/**
 * The bank a statement's account is held at, by the best evidence the file gives: the bank its format or CSV layout
 * belongs to (an owner's saved layout under the bank the owner named), else the servicer's BIC it states; null for any
 * other file.
 */
function statementBankIdentity(
	{format, layout, servicerBic}: NormalizedStatement,
	learnedBanks: ReadonlyMap<string, string>,
): BankIdentity | null {
	const bank =
		FORMAT_BANKS[format] ??
		(layout ? (CSV_LAYOUTS.find(({id}) => id === layout)?.bank ?? learnedBanks.get(layout)) : undefined);
	if (bank) return nameBankIdentity(bank);
	return servicerBic ? bicBankIdentity(servicerBic) : null;
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
function fileAccountIdentity({identifier, iban, bank, currency}: AccountRows): FileAccountIdentity {
	if (bank) {
		return {
			providerAccountId: `${FILE_BANK_ACCOUNT_PREFIX}${bank}:${currency}`,
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

type FileAccountIdentity = {providerAccountId: string; hashSeed: string; name: string};

const FILE_BANK_ACCOUNT_PREFIX = 'file-bank:';

/** Whether an account key is the bank-named account (`fileAccountIdentity`) of the bank, ignoring case and spacing. */
function fileBankAccountOf(providerAccountId: string, bank: string, currency: string): boolean {
	const suffix = `:${currency}`;
	return (
		providerAccountId.startsWith(FILE_BANK_ACCOUNT_PREFIX) &&
		providerAccountId.endsWith(suffix) &&
		bankNameKey(providerAccountId.slice(FILE_BANK_ACCOUNT_PREFIX.length, -suffix.length)) === bankNameKey(bank)
	);
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
	const names = new Map(holders.map(({bankConnection: {aspspName}}) => [bankNameKey(aspspName), aspspName.trim()]));
	return names.size === 1 ? [...names.values()][0] : null;
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

/**
 * A saved layout that checks neither a header nor an account: it recognises a file by its columns alone, which another
 * bank's export of the same shape can share.
 */
function unnamedHeaderlessLayout(layout: CsvLayout): boolean {
	return !('header' in layout.recognize) && layout.accountIban === undefined && layout.accountIbanLine === undefined;
}

/** Whether a part of the rows was read by one of the owner's saved layouts with no header that name no account. */
function headerlessPart({layout}: {layout: string | null}, headerlessLayouts: ReadonlySet<string>): boolean {
	return layout !== null && headerlessLayouts.has(layout);
}

/** Whether one of the owner's saved layouts with no header that name no account read any part of the rows. */
function readByHeaderlessLayout(rows: AccountRows, headerlessLayouts: ReadonlySet<string>): boolean {
	return rows.byFormat.some((part) => headerlessPart(part, headerlessLayouts));
}

/**
 * What the owner checks of the files headerless layouts read before saying where their rows go: the first rows of
 * every file, so a file another bank wrote shows its misread rows too, with the count and totals of the files' rows
 * (rows two files repeat count in each, as shown).
 */
function headerlessLayoutPreview(rows: AccountRows, headerlessLayouts: ReadonlySet<string>): BankImportLayoutPreview {
	const files = rows.byFormat.flatMap((part) => (headerlessPart(part, headerlessLayouts) ? part.byStatement : []));
	return {
		...previewOfRows(files.flat(), []),
		firstRows: files
			.flatMap((fileRows) => fileRows.slice(0, PREVIEW_ROWS_PER_FILE))
			.slice(0, MAX_PREVIEW_ROWS)
			.map(previewRow),
		lastRows: [],
	};
}

/**
 * The rows with their bank evidence as the account they go to may record it: none when only headerless layouts read
 * them and the owner placed them anywhere but that bank's own imported-files account, as nothing in such a file names
 * its bank. A statement another layout of that bank read is evidence of it.
 */
function placedEvidence(rows: AccountRows, account: BankAccount, headerlessLayouts: ReadonlySet<string>): AccountRows {
	if (
		!rows.bank ||
		!rows.byFormat.every((part) => headerlessPart(part, headerlessLayouts)) ||
		fileBankAccountOf(account.providerAccountId, rows.bank, rows.currency)
	) {
		return rows;
	}
	return {...rows, bankEvidence: []};
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
