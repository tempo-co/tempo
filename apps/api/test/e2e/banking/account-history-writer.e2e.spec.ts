import {INestApplication} from '@nestjs/common';
import {DataSource, EntityManager} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {lockReportingCurrencyForChange} from '@modules/banking/reporting-currency';
import {AccountHistoryWriterService} from '@modules/banking/services/account-history-writer.service';
import {BankConnectionRemovalService} from '@modules/banking/services/bank-connection-removal.service';
import {
	BankTransactionInput,
	BankTransactionPersistenceService,
} from '@modules/banking/services/bank-transaction-persistence.service';
import {BankingConsentRevocationService} from '@modules/banking/services/banking-consent-revocation.service';
import {BANK_CONNECTION_PROVIDERS} from '@modules/banking/services/banking-sync.constants';

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
	let persistence: BankTransactionPersistenceService;

	beforeAll(() => {
		app = getApp();
		dataSource = app.get(DataSource);
		fixtures = new BankingFixtures(app);
		writer = app.get(AccountHistoryWriterService);
		persistence = app.get(BankTransactionPersistenceService);
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

	/** Writes one row to the account inside the write the writer opened. */
	const writeRow = (
		manager: EntityManager,
		account: BankAccount,
		connection: BankConnection,
		ref: string,
		amount = '55.00',
	) =>
		persistence.persistTransactions(
			manager.getRepository(BankTransaction),
			account,
			[row(ref, amount)],
			connection.aspspName,
			connection.provider,
		);

	it('waits for a reporting-currency change under way, then stores no amount in the old currency', async () => {
		const {owner, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		await writer.write(owner.id, {syncedConnectionIds: [connection.id]}, ({manager}) =>
			writeRow(manager, bankAccount, connection, 'BEFORE'),
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
		const write = writer.write(owner.id, {syncedConnectionIds: [connection.id]}, ({manager}) =>
			writeRow(manager, bankAccount, connection, 'DURING', '12.50'),
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
			writer.write(
				owner.id,
				{syncedConnectionIds: [first.id, second.id], fileConnection: 'create'},
				({manager}) => writeRow(manager, firstAccount, first, 'FIRST'),
			),
			writer.write(
				owner.id,
				{syncedConnectionIds: [second.id, first.id], fileConnection: 'create'},
				({manager}) => writeRow(manager, secondAccount, second, 'SECOND'),
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
		jest.spyOn(app.get(BankingConsentRevocationService), 'revokeSessions').mockResolvedValue(undefined);

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
});
