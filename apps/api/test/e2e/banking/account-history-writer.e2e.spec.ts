import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {DataSource, Repository} from 'typeorm';

import {dateInAppTimeZone} from '@core/time/app-time-zone';
import {Account} from '@modules/account/account.entity';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {addDays} from '@modules/banking/banking.utils';
import {EnableBankingTransaction} from '@modules/banking/enable-banking.types';
import {lockReportingCurrencyForChange} from '@modules/banking/reporting-currency';
import {
	AccountHistoryWrite,
	AccountHistoryWriterService,
} from '@modules/banking/services/account-history-writer.service';
import {BankConnectionRemovalService} from '@modules/banking/services/bank-connection-removal.service';
import {BankTransactionInput} from '@modules/banking/services/bank-transaction-persistence.service';
import {BANK_CONNECTION_PROVIDERS} from '@modules/banking/services/banking-sync.constants';
import {EnableBankingClient} from '@modules/banking/services/enable-banking.client';
import {FileAccountBalanceService} from '@modules/banking/services/file-account-balance.service';
import {BankImport} from '@modules/file-import/bank-import.entity';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';
import {waitFor} from '../../utils/wait-utils';

const row = (entryReference: string, amount: string): BankTransactionInput => ({
	entryReference,
	amount,
	currency: 'EUR',
	creditDebitIndicator: 'DBIT',
	status: 'BOOK',
	bookingDate: '2026-04-15',
	valueDate: '2026-04-15',
	description: 'Example Shop',
});

describe('AccountHistoryWriterService', () => {
	let app: INestApplication;
	let dataSource: DataSource;
	let fixtures: BankingFixtures;
	let writer: AccountHistoryWriterService;

	beforeAll(() => {
		app = getApp();
		dataSource = app.get(DataSource);
		fixtures = new BankingFixtures(app);
		writer = app.get(AccountHistoryWriterService);
	});

	afterEach(() => jest.restoreAllMocks());

	/** How many database sessions of the test database wait on a lock. */
	async function lockWaits() {
		const [{waiting}] = await dataSource.query<Array<{waiting: number}>>(
			`SELECT count(*)::int AS "waiting" FROM pg_stat_activity
			WHERE datname = current_database() AND wait_event_type = 'Lock'`,
		);
		return waiting;
	}

	/** Records a fetch of one row of the account inside the write the writer opened. */
	const writeRow = (
		write: AccountHistoryWrite,
		account: BankAccount,
		connection: BankConnection,
		ref: string,
		amount = '55.00',
	) =>
		writer.recordBankFetch(write, {
			bankAccount: account,
			connection,
			transactions: [row(ref, amount)],
			fetchOptions: {strategy: 'default', dateFrom: '2026-04-01'},
			succeeded: false,
			complete: false,
			fetchedThrough: '2026-04-15',
		});

	it('waits for a reporting-currency change under way, then stores no amount in the old currency', async () => {
		const {owner, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		await writer.write(owner.id, {syncedConnectionIds: [connection.id]}, (write) =>
			writeRow(write, bankAccount, connection, 'BEFORE'),
		);
		expect(await fixtures.transactions.findOneByOrFail({entryReference: 'BEFORE'})).toMatchObject({
			amountInBaseCurrency: '-55.00',
		});

		let commitChange!: () => void;
		const changeHolds = new Promise<void>((resolve) => (commitChange = resolve));
		let changeStarted!: () => void;
		const changeLocked = new Promise<void>((resolve) => (changeStarted = resolve));
		const change = dataSource.transaction(async (manager) => {
			await lockReportingCurrencyForChange(manager, owner.id);
			await manager.getRepository(Account).update({id: owner.id}, {baseCurrency: 'GBP'});
			changeStarted();
			await changeHolds;
		});
		await changeLocked;
		const write = writer.write(owner.id, {syncedConnectionIds: [connection.id]}, (write) =>
			writeRow(write, bankAccount, connection, 'DURING', '12.50'),
		);
		try {
			await waitFor(lockWaits, (waiting) => waiting === 1);
		} finally {
			commitChange();
		}
		await Promise.all([change, write]);

		expect(await fixtures.transactions.findOneByOrFail({entryReference: 'DURING'})).toMatchObject({
			amountInBaseCurrency: null,
			baseAmountMethod: null,
		});
	});

	it('commits two writes that name the same connections in different orders', async () => {
		const {
			owner,
			connection: first,
			bankAccount: firstAccount,
		} = await createBankingOwner(app, {
			baseCurrency: 'EUR',
		});
		const second = await fixtures.createConnection(owner, {aspspName: 'Example Bank'});
		const secondAccount = await fixtures.createBankAccount(second);

		await Promise.all([
			writer.write(owner.id, {syncedConnectionIds: [first.id, second.id], fileConnection: 'create'}, (write) =>
				writeRow(write, firstAccount, first, 'FIRST'),
			),
			writer.write(owner.id, {syncedConnectionIds: [second.id, first.id], fileConnection: 'create'}, (write) =>
				writeRow(write, secondAccount, second, 'SECOND'),
			),
		]);

		expect(
			(await fixtures.transactions.findBy({bankAccountId: firstAccount.id})).map(
				({entryReference}) => entryReference,
			),
		).toEqual(['FIRST']);
		expect(
			(await fixtures.transactions.findBy({bankAccountId: secondAccount.id})).map(
				({entryReference}) => entryReference,
			),
		).toEqual(['SECOND']);
	}, 30_000);

	it('commits a write holding the imported-files connection and a removal that keeps the bank accounts', async () => {
		const {owner, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		await writer.write(owner.id, {fileConnection: 'create'}, async () => undefined);
		jest.spyOn(app.get(EnableBankingClient), 'deleteSession').mockResolvedValue(undefined);

		let fileLocked!: () => void;
		const holdsFileConnection = new Promise<void>((resolve) => (fileLocked = resolve));
		// Locks the bank connection after the imported-files one, as an undo of a drop recorded under the bank does.
		const write = writer.write(owner.id, {fileConnection: 'existing'}, async ({manager, fileConnection}) => {
			expect(fileConnection).not.toBeNull();
			fileLocked();
			await waitFor(lockWaits, (waiting) => waiting === 1);
			await manager.getRepository(BankConnection).findOneOrFail({
				where: {id: connection.id},
				lock: {mode: 'pessimistic_write'},
			});
		});
		await holdsFileConnection;
		const removal = app
			.get(BankConnectionRemovalService)
			.removeConnection(owner.id, connection.id, {keepAccounts: true});
		await Promise.all([write, removal]);

		expect(
			await fixtures.bankAccounts.findOneOrFail({where: {id: bankAccount.id}, relations: {bankConnection: true}}),
		).toMatchObject({bankConnection: {provider: BANK_CONNECTION_PROVIDERS.FILE}});
	});

	it("commits an owner's first write creating the imported-files connection and a removal that keeps the bank accounts", async () => {
		const {owner, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		jest.spyOn(app.get(EnableBankingClient), 'deleteSession').mockResolvedValue(undefined);
		// The removal stops once it holds its locks, until the write is under way.
		const balances = app.get(FileAccountBalanceService);
		const findAnchored = balances.findAnchoredByConnection.bind(balances);
		let removalLocked!: () => void;
		const removalHolds = new Promise<void>((resolve) => (removalLocked = resolve));
		let resumeRemoval!: () => void;
		const removalResumes = new Promise<void>((resolve) => (resumeRemoval = resolve));
		jest.spyOn(balances, 'findAnchoredByConnection').mockImplementationOnce(async (...args) => {
			removalLocked();
			await removalResumes;
			return findAnchored(...args);
		});
		const removal = app
			.get(BankConnectionRemovalService)
			.removeConnection(owner.id, connection.id, {keepAccounts: true});
		await removalHolds;
		const write = writer.write(owner.id, {fileConnection: 'create'}, async ({fileConnection}) => fileConnection);
		try {
			await waitFor(lockWaits, (waiting) => waiting === 1);
		} finally {
			resumeRemoval();
		}
		const [fileConnection] = await Promise.all([write, removal]);

		const fileConnections = await fixtures.connections.findBy({
			accountId: owner.id,
			provider: BANK_CONNECTION_PROVIDERS.FILE,
		});
		expect(fileConnections.map(({id}) => id)).toEqual([fileConnection?.id]);
		expect(
			await fixtures.bankAccounts.findOneOrFail({where: {id: bankAccount.id}, relations: {bankConnection: true}}),
		).toMatchObject({bankConnection: {id: fileConnection?.id}});
	});

	describe('recording a bank fetch for an account', () => {
		const today = dateInAppTimeZone(new Date());
		const day = (daysAgo: number) => addDays(today, -daysAgo);

		type Fetch = {
			transactions: EnableBankingTransaction[];
			dateFrom: string;
			succeeded?: boolean;
			complete?: boolean;
		};

		/** Records one fetch of the account as a sync run does, reading the account as the run found it. */
		async function recordFetch(
			owner: Account,
			connection: BankConnection,
			bankAccountId: string,
			{transactions, dateFrom, succeeded = true, complete = true}: Fetch,
		) {
			const bankAccount = await fixtures.bankAccounts.findOneByOrFail({id: bankAccountId});
			return writer.write(owner.id, {}, (write) =>
				writer.recordBankFetch(write, {
					connection,
					bankAccount,
					transactions,
					fetchOptions: {strategy: 'default', dateFrom},
					succeeded,
					complete,
					fetchedThrough: today,
				}),
			);
		}

		const booked = (fields: Partial<EnableBankingTransaction>): EnableBankingTransaction => ({
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			status: 'BOOK',
			...fields,
		});
		/** A pending card payment as the client reads it: both missing dates filled from the transaction date. */
		const pending = (entryReference: string, amount: string, onDay: string) =>
			booked({
				entryReference,
				amount,
				status: 'PDNG',
				transactionDate: onDay,
				bookingDate: onDay,
				bookingDateFilled: true,
				valueDate: onDay,
				valueDateFilled: true,
				description: `Example Card ${entryReference}`,
			});

		async function rowsOf(bankAccountId: string) {
			return fixtures.transactions.find({where: {bankAccountId}, order: {amount: 'ASC', id: 'ASC'}});
		}

		it('stores the fetched rows by identity, books pending rows into them, removes the ones gone, extends coverage and the watermark, and returns what it wrote', async () => {
			const {owner, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
			await fixtures.bankAccounts.update(
				{id: bankAccount.id},
				{syncCoveredFrom: day(30), syncCoveredThrough: day(5), transactionsFetchedThrough: day(5)},
			);
			const savings = await fixtures.createBankAccount(connection, {name: 'Savings'});
			const [counterpart] = await fixtures.createTransactions(savings, [{amount: '7.50', bookingDate: day(2)}]);
			const shop = booked({
				bookingDate: day(4),
				valueDate: day(4),
				description: 'Example Shop',
				counterpartyLocation: {city: 'Exampletown', region: 'Example Region', country: 'NL'},
			});

			const first = await recordFetch(owner, connection, bankAccount.id, {
				dateFrom: day(12),
				// Two identical rows without a reference are two payments.
				transactions: [pending('CARD-1', '20.00', day(3)), pending('CARD-2', '7.50', day(2)), shop, shop],
			});
			const stored = await rowsOf(bankAccount.id);
			expect(first).toEqual({
				transactionsAdded: 4,
				change: {
					kind: 'sync-write',
					writtenIds: expect.arrayContaining(stored.map(({id}) => id)),
					formerCounterpartIds: [],
				},
			});
			expect(first.change.writtenIds).toHaveLength(4);
			expect(stored.find(({description}) => description === 'Example Shop')).toMatchObject({
				merchantLocation: {city: 'Exampletown', region: 'Example Region', country: 'NL'},
			});
			const card1 = stored.find(({entryReference}) => entryReference === 'CARD-1')!;
			const card2 = stored.find(({entryReference}) => entryReference === 'CARD-2')!;
			const shopIds = stored.filter(({description}) => description === 'Example Shop').map(({id}) => id);
			await fixtures.transactions.update({id: card2.id}, {ownTransferCounterpartId: counterpart.id});

			const second = await recordFetch(owner, connection, bankAccount.id, {
				dateFrom: day(12),
				transactions: [
					// Booking changes the dates, never what the payment was for.
					{
						...pending('CARD-1', '20.00', day(3)),
						status: 'BOOK',
						bookingDate: day(2),
						bookingDateFilled: false,
						valueDate: day(1),
						valueDateFilled: false,
					},
					{...shop, description: 'Example Shop Amsterdam'},
					{...shop, description: 'Example Shop Amsterdam'},
				],
			});

			expect(second).toEqual({
				transactionsAdded: 0,
				change: {
					kind: 'sync-write',
					writtenIds: expect.arrayContaining([card1.id, ...shopIds]),
					formerCounterpartIds: [counterpart.id],
				},
			});
			expect(second.change.writtenIds).toHaveLength(3);
			expect(
				(await rowsOf(bankAccount.id)).map(({id, transactionStatus, description}) => ({
					id,
					transactionStatus,
					description,
				})),
			).toEqual(
				expect.arrayContaining([
					{id: card1.id, transactionStatus: 'BOOK', description: 'Example Card CARD-1'},
					...shopIds.map((id) => ({id, transactionStatus: 'BOOK', description: 'Example Shop Amsterdam'})),
				]),
			);
			expect(await fixtures.transactions.countBy({bankAccountId: bankAccount.id})).toBe(3);
			expect(await fixtures.bankAccounts.findOneByOrFail({id: bankAccount.id})).toMatchObject({
				syncCoveredFrom: day(30),
				syncCoveredThrough: today,
				transactionsFetchedThrough: today,
			});
		});

		it('removes the imported rows the bank never sent from the days it is final for, which end before its oldest pending row', async () => {
			const {owner, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
			await fixtures.bankAccounts.update(
				{id: bankAccount.id},
				{syncCoveredFrom: day(60), syncCoveredThrough: day(5), transactionsFetchedThrough: day(5)},
			);
			const stillPending = pending('CARD-KEPT', '30.00', day(12));
			await recordFetch(owner, connection, bankAccount.id, {
				dateFrom: day(20),
				transactions: [pending('CARD-GONE', '40.00', day(15)), stillPending],
			});
			const savings = await fixtures.createBankAccount(connection, {name: 'Savings'});
			const [counterpart] = await fixtures.createTransactions(savings, [{amount: '9.00', bookingDate: day(30)}]);
			const record = await app.get<Repository<BankImport>>(getRepositoryToken(BankImport)).save({
				accountId: owner.id,
				bankConnectionId: connection.id,
				fileHash: 'a'.repeat(64),
				format: 'camt053',
				filesCount: 1,
				rowsParsed: 3,
				rowsAdded: 3,
				rowsAlreadyPresent: 0,
				bankAccountIds: [bankAccount.id],
				createdBankAccountIds: [],
			});
			const imported = (onDay: string, amount: string, ownTransferCounterpartId: string | null = null) => ({
				importId: record.id,
				amount,
				bookingDate: onDay,
				valueDate: onDay,
				description: `Example Market ${amount}`,
				ownTransferCounterpartId,
			});
			const [farBack, beforePending, afterPending] = await fixtures.createTransactions(bankAccount, [
				imported(day(30), '-1.00', counterpart.id),
				imported(day(14), '-2.00'),
				imported(day(11), '-3.00'),
			]);

			const recorded = await recordFetch(owner, connection, bankAccount.id, {
				dateFrom: day(20),
				transactions: [stillPending],
			});

			// Final through the day before the oldest pending row left after the removal: 13 days ago.
			const remaining = (await rowsOf(bankAccount.id)).map(({id}) => id);
			expect(remaining).toEqual(expect.arrayContaining([afterPending.id]));
			expect(remaining).not.toContain(farBack.id);
			expect(remaining).not.toContain(beforePending.id);
			expect(remaining).toHaveLength(2);
			expect(recorded.change.formerCounterpartIds).toEqual([counterpart.id]);
		});

		it.each([
			['every page fetched but a row unreadable', true, today],
			['a page failed', false, day(5)],
		])(
			'stores the rows of a fetch with %s, keeps pending rows and coverage, and moves the watermark only when every page came',
			async (_case, succeeded, watermark) => {
				const {owner, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
				await fixtures.bankAccounts.update(
					{id: bankAccount.id},
					{syncCoveredFrom: day(30), syncCoveredThrough: day(5), transactionsFetchedThrough: day(5)},
				);
				await recordFetch(owner, connection, bankAccount.id, {
					dateFrom: day(12),
					transactions: [pending('CARD-1', '20.00', day(3))],
					succeeded: false,
					complete: false,
				});
				await fixtures.bankAccounts.update({id: bankAccount.id}, {transactionsFetchedThrough: day(5)});

				const recorded = await recordFetch(owner, connection, bankAccount.id, {
					dateFrom: day(12),
					transactions: [booked({entryReference: 'SHOP-1', bookingDate: day(2), valueDate: day(2)})],
					succeeded,
					complete: false,
				});

				expect(recorded).toMatchObject({transactionsAdded: 1, change: {formerCounterpartIds: []}});
				expect((await rowsOf(bankAccount.id)).map(({entryReference}) => entryReference).sort()).toEqual([
					'CARD-1',
					'SHOP-1',
				]);
				expect(await fixtures.bankAccounts.findOneByOrFail({id: bankAccount.id})).toMatchObject({
					syncCoveredFrom: day(30),
					syncCoveredThrough: day(5),
					transactionsFetchedThrough: watermark,
				});
			},
		);

		it('gives a fetched row in the reporting currency its own amount, leaves another currency to the conversion, and clears a converted amount whose inputs changed', async () => {
			const {owner, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
			const onDay = (fields: Partial<EnableBankingTransaction>) =>
				booked({bookingDate: day(3), valueDate: day(3), ...fields});
			await recordFetch(owner, connection, bankAccount.id, {
				dateFrom: day(12),
				transactions: [
					onDay({entryReference: 'EUR-1', amount: '12.34'}),
					{...pending('USD-1', '20.00', day(3)), currency: 'USD'},
					onDay({entryReference: 'USD-2', currency: 'USD', amount: '30.00'}),
				],
			});
			const amountsOf = async () =>
				Object.fromEntries(
					(await rowsOf(bankAccount.id)).map(
						({entryReference, amountInBaseCurrency, baseAmountMethod, baseAmountRateDate}) => [
							entryReference,
							{amountInBaseCurrency, baseAmountMethod, baseAmountRateDate},
						],
					),
				);
			const unconverted = {amountInBaseCurrency: null, baseAmountMethod: null, baseAmountRateDate: null};
			const converted = (amountInBaseCurrency: string) => ({
				amountInBaseCurrency,
				baseAmountMethod: 'ECB' as const,
				baseAmountRateDate: day(4),
			});
			expect(await amountsOf()).toEqual({
				'EUR-1': {amountInBaseCurrency: '-12.34', baseAmountMethod: 'SAME', baseAmountRateDate: null},
				'USD-1': unconverted,
				'USD-2': unconverted,
			});

			// As the conversion job leaves them.
			for (const [entryReference, amount] of [
				['USD-1', '-18.00'],
				['USD-2', '-27.00'],
			]) {
				await fixtures.transactions.update({bankAccountId: bankAccount.id, entryReference}, converted(amount));
			}
			await recordFetch(owner, connection, bankAccount.id, {
				dateFrom: day(12),
				transactions: [
					onDay({entryReference: 'EUR-1', amount: '12.34'}),
					// Booking moved its dates, so the converted amount is stale.
					{
						...pending('USD-1', '20.00', day(3)),
						currency: 'USD',
						status: 'BOOK',
						bookingDate: day(1),
						bookingDateFilled: false,
					},
					// A new description converts the same.
					onDay({entryReference: 'USD-2', currency: 'USD', amount: '30.00', description: 'Example Shop'}),
				],
			});

			expect(await amountsOf()).toEqual({
				'EUR-1': {amountInBaseCurrency: '-12.34', baseAmountMethod: 'SAME', baseAmountRateDate: null},
				'USD-1': unconverted,
				'USD-2': converted('-27.00'),
			});
		});
	});

	describe('adding file rows to an account', () => {
		const today = dateInAppTimeZone(new Date());
		const day = (daysAgo: number) => addDays(today, -daysAgo);
		const fileRow = (entryReference: string, amount: string, onDay: string): BankTransactionInput => ({
			...row(entryReference, amount),
			bookingDate: onDay,
			valueDate: onDay,
		});

		const saveImport = (owner: Account, connectionId: string, bankAccountId: string) =>
			app.get<Repository<BankImport>>(getRepositoryToken(BankImport)).save({
				accountId: owner.id,
				bankConnectionId: connectionId,
				fileHash: 'b'.repeat(64),
				format: 'camt053',
				filesCount: 1,
				rowsParsed: 1,
				rowsAdded: 1,
				rowsAlreadyPresent: 0,
				bankAccountIds: [bankAccountId],
				createdBankAccountIds: [],
			});

		it("gives a synced account's final days, which end before its oldest pending row, stores the rows of other days as the import's, a row in the reporting currency with its own amount, and returns them as a file write", async () => {
			const {owner, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
			await fixtures.bankAccounts.update(
				{id: bankAccount.id},
				{
					syncCoveredFrom: day(60),
					syncCoveredThrough: day(5),
					currentBalanceAmount: '250.00',
					currentBalanceType: 'ITAV',
				},
			);
			await fixtures.createTransactions(bankAccount, [
				{amount: '-4.00', bookingDate: day(20), valueDate: day(20), transactionStatus: 'PDNG'},
			]);
			const record = await saveImport(owner, connection.id, bankAccount.id);
			const account = await fixtures.bankAccounts.findOneByOrFail({id: bankAccount.id});

			const added = await writer.write(owner.id, {syncedConnectionIds: [connection.id]}, (write) =>
				writer.addFileRows(write, {account, connection, importId: record.id}, async ({finalDays, insert}) => ({
					finalDays,
					ids: await insert(
						[
							fileRow('FILE-1', '5.00', day(10)),
							fileRow('FINAL', '7.00', day(30)),
							{...fileRow('FILE-2', '6.00', day(10)), currency: 'USD'},
						],
						{statementNumbering: 'camt053'},
					),
				})),
			);

			expect(added.result.finalDays).toEqual({from: day(52), through: day(21)});
			expect(added.result.ids).toHaveLength(2);
			expect(added.change).toEqual({kind: 'file-write', writtenIds: added.result.ids});
			expect(added.balance).toBeNull();
			expect(
				await fixtures.transactions.find({where: {importId: record.id}, order: {entryReference: 'ASC'}}),
			).toEqual([
				expect.objectContaining({
					id: added.result.ids[0],
					entryReference: 'FILE-1',
					statementNumbering: 'camt053',
					amountInBaseCurrency: '-5.00',
					baseAmountMethod: 'SAME',
				}),
				// Another currency waits for the conversion.
				expect.objectContaining({
					id: added.result.ids[1],
					entryReference: 'FILE-2',
					statementNumbering: 'camt053',
					amountInBaseCurrency: null,
					baseAmountMethod: null,
				}),
			]);
			expect(await fixtures.bankAccounts.findOneByOrFail({id: bankAccount.id})).toMatchObject({
				currentBalanceAmount: '250.00000000',
			});
		});

		it("moves the balance of an account its bank's removal kept with the rows added to it, and gives it no final days", async () => {
			const {owner, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
			await writer.write(owner.id, {fileConnection: 'create'}, async () => undefined);
			jest.spyOn(app.get(EnableBankingClient), 'deleteSession').mockResolvedValue(undefined);
			await app.get(BankConnectionRemovalService).removeConnection(owner.id, connection.id, {keepAccounts: true});
			await fixtures.bankAccounts.update(
				{id: bankAccount.id},
				{
					syncCoveredFrom: day(60),
					syncCoveredThrough: day(5),
					statedBalanceAmount: '100.00',
					statedBalanceDate: day(10),
				},
			);
			const kept = await fixtures.bankAccounts.findOneOrFail({
				where: {id: bankAccount.id},
				relations: {bankConnection: true},
			});
			const record = await saveImport(owner, kept.bankConnection.id, kept.id);

			const added = await writer.write(owner.id, {fileConnection: 'existing'}, (write) =>
				writer.addFileRows(
					write,
					{account: kept, connection: kept.bankConnection, importId: record.id},
					async ({finalDays, insert}) => ({
						finalDays,
						ids: await insert([fileRow('FILE-1', '5.00', day(3))], {statementNumbering: null}),
					}),
				),
			);

			expect(added.result.finalDays).toBeNull();
			expect(added.change).toEqual({kind: 'file-write', writtenIds: added.result.ids});
			expect(await fixtures.transactions.findOneByOrFail({id: added.result.ids[0]})).toMatchObject({
				importId: record.id,
			});
			expect(Number(added.balance?.currentBalanceAmount)).toBe(95);
			expect(await fixtures.transactions.findOneByOrFail({id: added.result.ids[0]})).toMatchObject({
				amountInBaseCurrency: '-5.00',
				baseAmountMethod: 'SAME',
			});
			const stored = await fixtures.bankAccounts.findOneByOrFail({id: kept.id});
			expect(Number(stored.currentBalanceAmount)).toBe(95);
			expect(stored.balanceUpdatedAt).toEqual(new Date(`${day(3)}T00:00:00.000Z`));
		});
	});
});
