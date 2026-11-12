import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import type {BankImportSummary} from '@tempo/contracts';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Server} from 'node:net';
import {join} from 'node:path';
import {deflateRawSync} from 'node:zlib';
import TestAgent from 'supertest/lib/agent';
import {In, Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {Account} from '@modules/account/account.entity';
import {BankConnectionAlertService} from '@modules/banking/alerts/bank-connection-alert.service';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {
	createBankTransactionStableIdentityGroupKey,
	createBankTransactionStableIdentityKey,
} from '@modules/banking/bank-transaction-identity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {EnableBankingTransaction} from '@modules/banking/enable-banking.types';
import {BankingConnectionLockService} from '@modules/banking/services/banking-connection-lock.service';
import {BankingEncryptionService} from '@modules/banking/services/banking-encryption.service';
import {BankingSyncQueueService} from '@modules/banking/services/banking-sync-queue.service';
import {BankingSyncService} from '@modules/banking/services/banking-sync.service';
import {EnableBankingClient} from '@modules/banking/services/enable-banking.client';
import {BankImportDoubtfulRow} from '@modules/file-import/bank-import-doubtful-row.entity';
import {BankImport} from '@modules/file-import/bank-import.entity';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {EXAMPLE_IBAN, OTHER_EXAMPLE_IBAN, camt053, createZip} from '../../fixtures/statement-file.fixture';
import {enableFileImportE2e, getApp} from '../../setup/e2e.setup';
import {createVerifiedAccount} from '../../utils/auth-utils';

enableFileImportE2e();

const ORIGIN = 'http://localhost:5173';
const FIXTURES = join(__dirname, '../../fixtures/file-import');
const ARCHIVE = readFileSync(join(FIXTURES, 'camt053-synthetic.zip'));
const STATEMENT_FILES = ['020326', '030326', '040326'].map((day) =>
	readFileSync(join(FIXTURES, `0417164300_99999999_${day}000000.xml`)),
);
// The same account and days as the CAMT.053 files plus 5 March, in each of ABN AMRO's other export formats.
const CAMT_FILES = [...STATEMENT_FILES, readFileSync(join(FIXTURES, '0417164300_99999999_050326000000.xml'))];
const MT940_FILE = readFileSync(join(FIXTURES, 'MT940260305120000.STA'));
const TXT_FILE = readFileSync(join(FIXTURES, 'TXT260305120000.TAB'));
// One Revolut export with EUR and RON rows, as CSV and as a workbook.
const REVOLUT_CSV = readFileSync(join(FIXTURES, 'account-statement_2026-03-01_2026-03-05_en-gb_a0b1c2.csv'));
const REVOLUT_XLSX = readFileSync(join(FIXTURES, 'account-statement_2026-03-01_2026-03-05_en-gb_a0b1c2.xlsx'));
// Enable Banking's identification hash of EXAMPLE_IBAN in EUR, in the shape it uses for IBAN accounts.
const EXAMPLE_IBAN_HASH = [
	Buffer.from(
		JSON.stringify([
			['account', 'account_id', 'iban'],
			['account', 'currency'],
		]),
	).toString('base64url'),
	createHash('sha256').update(`[\n"${EXAMPLE_IBAN}",\n"EUR"\n]`).digest('base64url'),
].join('.');
const OTHER_STATEMENT = Buffer.from(
	camt053([
		{
			iban: OTHER_EXAMPLE_IBAN,
			sequence: '1',
			entries: [
				{amount: '20.00', reference: 'OTHER-1', bookingDate: '2026-03-05', info: 'Example Cafe'},
				{
					amount: '75.00',
					indicator: 'CRDT',
					reference: 'OTHER-2',
					bookingDate: '2026-03-06',
					info: 'Example refund',
				},
			],
		},
	]),
);
// The archive's 7 rows in booking order; its statements list them newest first.
// [booking date, value date, amount, bank reference, balance after]
const ARCHIVE_ROWS = [
	['2026-03-02', '2026-03-01', '-12.50000000', '6061000000000001', '987.50000000'],
	['2026-03-02', '2026-03-02', '-850.00000000', '6061000000000002', '137.50000000'],
	['2026-03-02', '2026-03-02', '2500.00000000', '6061000000000003', '2637.50000000'],
	['2026-03-04', '2026-03-03', '-12.50000000', '6063000000000001', '2625.00000000'],
	['2026-03-04', '2026-03-03', '-12.50000000', '6063000000000002', '2612.50000000'],
	['2026-03-04', '2026-03-04', '-39.99000000', '6063000000000003', '2572.51000000'],
	['2026-03-04', '2026-03-04', '-1.95000000', '6063000000000004', '2570.56000000'],
];
const MARCH_ROWS = [...ARCHIVE_ROWS, ['2026-03-05', '2026-03-05', '-24.95000000', '6064000000000001', '2545.61000000']];

describe('Bank imports', () => {
	jest.setTimeout(60_000);

	let app: INestApplication;
	let httpServer: Server;
	let fixtures: BankingFixtures;
	let accounts: Repository<Account>;
	let connections: Repository<BankConnection>;
	let bankAccounts: Repository<BankAccount>;
	let transactions: Repository<BankTransaction>;
	let imports: Repository<BankImport>;
	let doubtfulRows: Repository<BankImportDoubtfulRow>;

	beforeAll(() => {
		app = getApp();
		httpServer = app.getHttpServer();
		fixtures = new BankingFixtures(app);
		accounts = app.get(getRepositoryToken(Account));
		connections = fixtures.connections;
		bankAccounts = fixtures.bankAccounts;
		transactions = fixtures.transactions;
		imports = app.get(getRepositoryToken(BankImport));
		doubtfulRows = app.get(getRepositoryToken(BankImportDoubtfulRow));
	});

	async function createOwner(): Promise<{owner: Account; agent: TestAgent}> {
		const fresh = await createVerifiedAccount(httpServer, app.get(ConfigurationService).get('EMAIL_UI_URL'));
		await accounts.update({id: fresh.id}, {baseCurrency: 'EUR'});
		return {owner: await accounts.findOneByOrFail({id: fresh.id}), agent: fresh.agent};
	}

	function drop(agent: TestAgent, files: Buffer[]) {
		const upload = agent.post('/bank-imports').set('Origin', ORIGIN);
		for (const [index, file] of files.entries()) upload.attach('files', file, `upload-${index}.bin`);
		return upload;
	}

	function fileConnection(owner: Account) {
		return connections.findOneBy({accountId: owner.id, provider: 'file'});
	}

	async function ownerRows(owner: Account) {
		return transactions
			.createQueryBuilder('transaction')
			.innerJoin('transaction.bankAccount', 'bankAccount')
			.innerJoin('bankAccount.bankConnection', 'connection')
			.where('connection.accountId = :ownerId', {ownerId: owner.id})
			.orderBy('transaction.bookingDate', 'ASC')
			.addOrderBy('transaction.entryReference', 'ASC')
			.getMany();
	}

	/** What a row says about the payment, without ids, account-scoped keys or timestamps. */
	const rowContent = (row: BankTransaction) =>
		Object.fromEntries(
			(
				[
					'bookingDate',
					'valueDate',
					'transactionDate',
					'amount',
					'currency',
					'creditDebitIndicator',
					'transactionStatus',
					'entryReference',
					'description',
					'displayDescription',
					'merchantKey',
					'counterpartyName',
					'counterpartyIban',
					'remittanceInformation',
					'bankTransactionCode',
					'bankTransactionSubCode',
					'referenceNumber',
					'balanceAfterAmount',
					'balanceAfterCurrency',
					'amountInBaseCurrency',
				] as const
			).map((field) => [field, row[field]]),
		);

	it('imports a statement archive into a new account, adds nothing on a second drop and reads the unzipped files the same way', async () => {
		const {owner, agent} = await createOwner();

		const first = await drop(agent, [ARCHIVE]).expect(201);

		const connection = await fileConnection(owner);
		expect(connection).toMatchObject({
			provider: 'file',
			aspspName: 'Imported files',
			aspspCountry: 'ZZ',
			status: 'AUTHORIZED',
			syncStatus: 'IDLE',
			nextSyncAt: null,
			consentValidUntil: null,
			providerSessionId: null,
		});
		const [account] = await bankAccounts.find({where: {bankConnection: {id: connection!.id}}});
		expect(account).toMatchObject({
			iban: EXAMPLE_IBAN,
			providerAccountId: `file:${EXAMPLE_IBAN}:EUR`,
			identificationHash: `file:${createHash('sha256').update(`${EXAMPLE_IBAN}:EUR`).digest('hex')}`,
			name: 'NL91 ABNA 0417 1643 00',
			currency: 'EUR',
			isActive: true,
			currentBalanceAmount: null,
		});
		expect(first.body).toEqual({
			id: expect.any(String),
			format: 'camt053',
			filesCount: 1,
			rowsParsed: 7,
			rowsAdded: 7,
			rowsAlreadyPresent: 0,
			rowsMatchedByReference: 0,
			rowsMatchedByBalance: 0,
			rowsMatchedByDate: 0,
			rowsDoubtful: 0,
			dateFrom: '2026-03-02',
			dateTo: '2026-03-04',
			accounts: [{id: account.id, name: 'NL91 ABNA 0417 1643 00', currency: 'EUR', created: true}],
			undoneAt: null,
			createdAt: expect.any(String),
		} satisfies BankImportSummary);

		const rows = await ownerRows(owner);
		expect(
			rows.map(({bookingDate, valueDate, amount, entryReference, balanceAfterAmount}) => [
				bookingDate,
				valueDate,
				amount,
				entryReference,
				balanceAfterAmount,
			]),
		).toEqual(ARCHIVE_ROWS);
		expect(rows.every((row) => row.importId === first.body.id && row.bankAccountId === account.id)).toBe(true);
		expect(rows[2]).toMatchObject({
			creditDebitIndicator: 'CRDT',
			transactionStatus: 'BOOK',
			counterpartyName: 'Werkgever Example NV',
			counterpartyIban: 'NL39RABO0300065264',
			remittanceInformation: 'Salaris februari & bonus',
			referenceNumber: 'SAL-2026-02',
			balanceAfterCurrency: 'EUR',
			bankTransactionCode: 'RCDT',
			bankTransactionSubCode: 'ESCT',
			// Same-currency amounts count in totals straight away.
			amountInBaseCurrency: '2500.00',
			baseAmountMethod: 'SAME',
		});
		expect(rows[0]).toMatchObject({
			creditDebitIndicator: 'DBIT',
			counterpartyName: null,
			description: expect.stringContaining('Bakkerij Voorbeeld'),
		});

		const again = await drop(agent, [ARCHIVE]).expect(201);
		expect(again.body).toMatchObject({
			rowsParsed: 7,
			rowsAdded: 0,
			rowsAlreadyPresent: 7,
			rowsMatchedByReference: 7,
			accounts: [{id: account.id, created: false}],
		});
		expect(await ownerRows(owner)).toHaveLength(7);

		await agent.delete(`/bank-imports/${first.body.id}`).set('Origin', ORIGIN).expect(204);
		expect(await ownerRows(owner)).toEqual([]);
		expect(await bankAccounts.countBy({bankConnection: {id: connection!.id}})).toBe(0);

		const unzipped = await drop(agent, STATEMENT_FILES).expect(201);
		expect(unzipped.body).toMatchObject({filesCount: 3, rowsParsed: 7, rowsAdded: 7, rowsAlreadyPresent: 0});
		expect((await ownerRows(owner)).map(rowContent)).toEqual(rows.map(rowContent));

		const history = await agent.get('/bank-imports').expect(200);
		expect(history.body.map(({id, undoneAt}: BankImportSummary) => [id, Boolean(undoneAt)])).toEqual([
			[unzipped.body.id, false],
			[again.body.id, false],
			[first.body.id, true],
		]);
		// The undone import's account is gone; the unzipped drop created a new one.
		expect(history.body[2].accounts).toEqual([]);
	});

	it('undoes exactly the rows one import inserted, keeping the rows and accounts of another', async () => {
		const {owner, agent} = await createOwner();
		const archive = await drop(agent, [ARCHIVE]).expect(201);
		const extraEntry = Buffer.from(
			camt053([
				{
					sequence: '64',
					entries: [
						{
							amount: '3.00',
							reference: '6064000000000001',
							bookingDate: '2026-03-05',
							info: 'Example Shop',
						},
					],
				},
			]),
		);

		const overlapping = await drop(agent, [STATEMENT_FILES[2], extraEntry, OTHER_STATEMENT]).expect(201);
		expect(overlapping.body).toMatchObject({rowsParsed: 7, rowsAdded: 3, rowsAlreadyPresent: 4});
		const touched = overlapping.body.accounts as BankImportSummary['accounts'];
		const archiveAccount = touched.find(({created}) => !created)!;
		const otherAccount = touched.find(({created}) => created)!;
		expect(archiveAccount.id).toBe(archive.body.accounts[0].id);

		await agent.delete(`/bank-imports/${overlapping.body.id}`).set('Origin', ORIGIN).expect(204);

		const rows = await ownerRows(owner);
		expect(rows.map(({entryReference}) => entryReference)).toEqual(
			ARCHIVE_ROWS.map(([, , , reference]) => reference),
		);
		expect(rows.every(({importId}) => importId === archive.body.id)).toBe(true);
		expect(await bankAccounts.findOneBy({id: otherAccount.id})).toBeNull();
		expect(await bankAccounts.findOneBy({id: archiveAccount.id})).not.toBeNull();
		expect(await imports.findOneByOrFail({id: overlapping.body.id})).toMatchObject({undoneAt: expect.any(Date)});

		await agent.delete(`/bank-imports/${overlapping.body.id}`).set('Origin', ORIGIN).expect(404);
	});

	it('keeps an import to its owner', async () => {
		const {owner, agent} = await createOwner();
		const other = await createOwner();
		const imported = await drop(agent, [ARCHIVE]).expect(201);

		await other.agent.get('/bank-imports').expect(200, []);
		await other.agent.delete(`/bank-imports/${imported.body.id}`).set('Origin', ORIGIN).expect(404);

		expect(await ownerRows(owner)).toHaveLength(7);
		expect(await fileConnection(other.owner)).toBeNull();
	});

	it('gives two simultaneous first drops one imported-files connection', async () => {
		const {owner, agent} = await createOwner();

		const [archive, other] = await Promise.all([drop(agent, [ARCHIVE]), drop(agent, [OTHER_STATEMENT])]);

		expect([archive.status, other.status]).toEqual([201, 201]);
		expect(await connections.countBy({accountId: owner.id, provider: 'file'})).toBe(1);
		expect(await ownerRows(owner)).toHaveLength(9);
	});

	it('never syncs, refreshes, re-authorizes or alerts about the imported-files connection', async () => {
		const {owner, agent} = await createOwner();
		await drop(agent, [ARCHIVE]).expect(201);
		const connection = (await fileConnection(owner))!;
		// Give both connections every state that makes a bank connection due and alertable.
		const due = {
			nextSyncAt: new Date(Date.now() - 60_000),
			consentValidUntil: new Date(Date.now() + 60 * 60 * 1000),
		};
		await connections.update({id: connection.id}, due);
		const bankConnection = await fixtures.createConnection(owner, due);
		await connections.query(
			`UPDATE "bank_connections" SET "createdAt" = now() - interval '2 days' WHERE "id" = ANY($1::uuid[])`,
			[[connection.id, bankConnection.id]],
		);

		const dispatched = await app.get(BankingSyncQueueService).dispatchDueConnections();
		await app.get(BankConnectionAlertService).scan();

		expect(dispatched).toBe(1);
		const [fileAfter, bankAfter] = await Promise.all([
			connections.findOneByOrFail({id: connection.id}),
			connections.findOneByOrFail({id: bankConnection.id}),
		]);
		expect(fileAfter).toMatchObject({syncStatus: 'IDLE', consentFinalAlertFor: null, syncAlertFor: null});
		expect(bankAfter.consentFinalAlertFor ?? bankAfter.syncAlertFor).not.toBeNull();

		const refresh = await agent
			.post(`/bank-connections/${connection.id}/refresh`)
			.set('Origin', ORIGIN)
			.expect(409);
		expect(refresh.body.code).toBe('file_connection_not_syncable');
		const reauthorize = await agent
			.post('/bank-connections/authorize')
			.send({aspspName: 'Imported files', aspspCountry: 'ZZ'})
			.expect(409);
		expect(reauthorize.body.code).toBe('file_connection_not_syncable');

		const listed = await agent.get('/bank-connections').expect(200);
		expect(listed.body.find(({id}: {id: string}) => id === connection.id)).not.toHaveProperty('logo');
	});

	it('removes the imported-files connection with its accounts, rows and import history', async () => {
		const {owner, agent} = await createOwner();
		await drop(agent, [ARCHIVE, OTHER_STATEMENT]).expect(201);
		const connection = (await fileConnection(owner))!;

		await agent.delete(`/bank-connections/${connection.id}`).send({confirmation: 'DELETE'}).expect(204);

		expect(await ownerRows(owner)).toEqual([]);
		expect(await bankAccounts.countBy({bankConnection: {id: connection.id}})).toBe(0);
		expect(await imports.countBy({accountId: owner.id})).toBe(0);
	});

	it.each([
		{name: 'its IBAN', values: {iban: EXAMPLE_IBAN}},
		{name: 'its identification hash', values: {identificationHash: EXAMPLE_IBAN_HASH}},
	])('imports into the account bank sync holds, recognized by $name', async ({values}) => {
		const {owner, agent} = await createOwner();
		// An imported-files account with the same IBAN loses to the synced one.
		await drop(agent, [STATEMENT_FILES[0]]).expect(201);
		const fileAccount = await bankAccounts.findOneByOrFail({
			bankConnection: {accountId: owner.id, provider: 'file'},
		});
		const connection = await fixtures.createConnection(owner);
		const synced = await fixtures.createBankAccount(connection, values);

		const response = await drop(agent, [STATEMENT_FILES[2]]).expect(201);

		expect(response.body).toMatchObject({
			rowsAdded: 4,
			accounts: [{id: synced.id, name: 'Main account', currency: 'EUR', created: false}],
		});
		expect(await imports.findOneByOrFail({id: response.body.id})).toMatchObject({
			bankConnectionId: connection.id,
			bankAccountIds: [synced.id],
		});
		expect(await transactions.countBy({bankAccountId: synced.id, importId: response.body.id})).toBe(4);
		expect(await transactions.countBy({bankAccountId: fileAccount.id})).toBe(3);
	});

	it("imports one account's rows once across CAMT.053, MT940 and TXT, dropped in either order or all at once", async () => {
		const camtFirst = await createOwner();
		expect((await drop(camtFirst.agent, CAMT_FILES).expect(201)).body).toMatchObject({
			format: 'camt053',
			rowsAdded: 8,
		});
		// TXT books each row on its value date, MT940 on its statement's date.
		for (const [file, format, dateFrom] of [
			[TXT_FILE, 'abnAmroTxt', '2026-03-01'],
			[MT940_FILE, 'mt940', '2026-03-02'],
		] as const) {
			const again = await drop(camtFirst.agent, [file]).expect(201);
			expect(again.body).toMatchObject({
				format,
				rowsParsed: 8,
				rowsAdded: 0,
				rowsAlreadyPresent: 8,
				rowsMatchedByBalance: 8,
				rowsDoubtful: 0,
				dateFrom,
				dateTo: '2026-03-05',
			});
		}
		const camtRows = await ownerRows(camtFirst.owner);
		expect(camtRows).toHaveLength(8);

		const txtFirst = await createOwner();
		expect((await drop(txtFirst.agent, [TXT_FILE]).expect(201)).body).toMatchObject({rowsAdded: 8});
		const camtAfter = await drop(txtFirst.agent, CAMT_FILES).expect(201);
		expect(camtAfter.body).toMatchObject({rowsAdded: 0, rowsAlreadyPresent: 8, rowsDoubtful: 0});
		expect(await ownerRows(txtFirst.owner)).toHaveLength(8);

		const allAtOnce = await createOwner();
		const mixed = await drop(allAtOnce.agent, [TXT_FILE, MT940_FILE, ...CAMT_FILES]).expect(201);
		expect(mixed.body).toMatchObject({
			format: 'mixed',
			filesCount: 6,
			rowsParsed: 24,
			rowsAdded: 8,
			rowsAlreadyPresent: 16,
			rowsDoubtful: 0,
		});
		// CAMT.053 is matched first whatever the drop order, so the rows stored are its own, with bank references.
		expect((await ownerRows(allAtOnce.owner)).map(rowContent)).toEqual(camtRows.map(rowContent));
	});

	it('adds nothing from the MT940 or TXT export of a synced account that holds its rows as bank sync stores them', async () => {
		const {owner, agent} = await createOwner();
		const connection = await fixtures.createConnection(owner);
		const account = await fixtures.createBankAccount(connection, {iban: EXAMPLE_IBAN});
		await fixtures.createTransactions(
			account,
			MARCH_ROWS.map(([bookingDate, valueDate, amount, entryReference, balanceAfterAmount]) => ({
				bookingDate,
				valueDate,
				amount,
				creditDebitIndicator: amount.startsWith('-') ? 'DBIT' : 'CRDT',
				entryReference,
				balanceAfterAmount,
				balanceAfterCurrency: 'EUR',
			})),
		);

		for (const file of [MT940_FILE, TXT_FILE]) {
			const response = await drop(agent, [file]).expect(201);

			expect(response.body).toMatchObject({
				rowsAdded: 0,
				rowsMatchedByBalance: 8,
				rowsDoubtful: 0,
				accounts: [{id: account.id, created: false}],
			});
		}
		expect(await transactions.countBy({bankAccountId: account.id})).toBe(8);
	});

	it('imports a Revolut statement into the synced Revolut account of its currency, and into Revolut accounts of their own otherwise', async () => {
		const {owner, agent} = await createOwner();
		const connection = await fixtures.createConnection(owner, {aspspName: ' revolut '});
		const synced = await fixtures.createBankAccount(connection, {currency: 'EUR'});
		// As bank sync stores them: booked on the started date, without balances. The fee, the exchange and the
		// incoming transfer are missing.
		await fixtures.createTransactions(
			synced,
			[
				['2026-03-01', '200.00'],
				['2026-03-01', '-4.50'],
				['2026-03-01', '-4.50'],
				['2026-03-02', '-50.00'],
			].map(([bookingDate, amount]) => ({
				bookingDate,
				amount,
				creditDebitIndicator: amount.startsWith('-') ? 'DBIT' : 'CRDT',
			})),
		);

		const response = await drop(agent, [REVOLUT_CSV]).expect(201);

		expect(response.body).toMatchObject({
			format: 'revolutCsv',
			rowsParsed: 9,
			rowsAdded: 5,
			rowsAlreadyPresent: 4,
			rowsMatchedByDate: 4,
			rowsDoubtful: 0,
			accounts: [
				{id: synced.id, name: 'Main account', currency: 'EUR', created: false},
				{id: expect.any(String), name: 'Revolut RON', currency: 'RON', created: true},
			],
		});
		expect(await imports.findOneByOrFail({id: response.body.id})).toMatchObject({bankConnectionId: connection.id});
		const added = await transactions.find({where: {bankAccountId: synced.id, importId: response.body.id}});
		expect(added.map(({amount}) => amount).sort()).toEqual(['-20.00000000', '-7.99000000', '25.00000000']);
		const ron = await bankAccounts.findOneOrFail({
			where: {id: response.body.accounts[1].id},
			relations: {bankConnection: true},
		});
		expect(ron).toMatchObject({providerAccountId: 'file-bank:Revolut:RON', iban: null});
		expect(ron.bankConnection.provider).toBe('file');
		expect(await transactions.countBy({bankAccountId: ron.id})).toBe(2);

		const other = await createOwner();
		const csv = await drop(other.agent, [REVOLUT_CSV]).expect(201);
		expect(csv.body).toMatchObject({
			rowsAdded: 9,
			accounts: [
				{name: 'Revolut EUR', currency: 'EUR', created: true},
				{name: 'Revolut RON', currency: 'RON', created: true},
			],
		});
		const xlsx = await drop(other.agent, [REVOLUT_XLSX]).expect(201);
		expect(xlsx.body).toMatchObject({
			format: 'revolutXlsx',
			rowsParsed: 9,
			rowsAdded: 0,
			rowsAlreadyPresent: 9,
			rowsDoubtful: 0,
			accounts: csv.body.accounts.map(({id}: BankImportSummary['accounts'][number]) => ({id, created: false})),
		});
	});

	it('records a drop into a synced and an imported-files account under the synced connection, and refuses a drop reaching two synced connections', async () => {
		const {owner, agent} = await createOwner();
		const connection = await fixtures.createConnection(owner);
		const synced = await fixtures.createBankAccount(connection, {iban: EXAMPLE_IBAN});

		const mixed = await drop(agent, [STATEMENT_FILES[0], OTHER_STATEMENT]).expect(201);

		expect(mixed.body).toMatchObject({rowsAdded: 5});
		expect(await imports.findOneByOrFail({id: mixed.body.id})).toMatchObject({bankConnectionId: connection.id});
		// Removing the imported-files connection takes its own account; the record still undoes the synced rows.
		const files = (await fileConnection(owner))!;
		await agent.delete(`/bank-connections/${files.id}`).send({confirmation: 'DELETE'}).expect(204);
		expect(await transactions.countBy({bankAccountId: synced.id, importId: mixed.body.id})).toBe(3);
		await agent.delete(`/bank-imports/${mixed.body.id}`).set('Origin', ORIGIN).expect(204);
		expect(await transactions.countBy({bankAccountId: synced.id})).toBe(0);

		await fixtures.createBankAccount(await fixtures.createConnection(owner), {iban: OTHER_EXAMPLE_IBAN});
		const refused = await drop(agent, [STATEMENT_FILES[0], OTHER_STATEMENT]).expect(422);
		expect(refused.body).toMatchObject({code: 'multiple_bank_connections', file: null});
		expect(await imports.countBy({accountId: owner.id})).toBe(1);
		expect(await transactions.countBy({bankAccountId: synced.id})).toBe(0);
	});

	it('runs the duplicate ladder against a synced account, holds doubtful rows and undoes only what it added', async () => {
		const {owner, agent} = await createOwner();
		const connection = await fixtures.createConnection(owner, {nextSyncAt: new Date('2030-01-01T00:00:00.000Z')});
		const account = await fixtures.createBankAccount(connection, {
			iban: EXAMPLE_IBAN,
			currentBalanceAmount: '470.00',
		});
		const synced = (values: Parameters<typeof fixtures.createTransaction>[1]) =>
			fixtures.createTransaction(account, {
				transactionDate: null,
				valueDate: (values?.bookingDate as string) ?? null,
				amountInBaseCurrency: values?.amount as string,
				baseAmountMethod: 'SAME',
				...values,
			});
		const byReference = await synced({
			amount: '-20.00',
			bookingDate: '2026-03-11',
			transactionDate: '2026-03-10',
			entryReference: 'BANK-REF-1',
		});
		const byBalance = await synced({
			amount: '-30.00',
			bookingDate: '2026-03-12',
			valueDate: '2026-03-09',
			balanceAfterAmount: '470.00',
			balanceAfterCurrency: 'EUR',
		});
		// A row a sync stored without a reference, with the identity keys sync gives it.
		const sameDay = await synced({amount: '-5.00', bookingDate: '2026-03-10'});
		await transactions.update(
			{id: sameDay.id},
			{
				stableIdentityGroupKey: createBankTransactionStableIdentityGroupKey(sameDay),
				stableIdentityKey: createBankTransactionStableIdentityKey(sameDay, 1),
			},
		);
		const nearby = await synced({amount: '-7.00', bookingDate: '2026-03-13'});
		const doubtfulCandidates = [
			await synced({amount: '-11.00', bookingDate: '2026-03-08'}),
			await synced({amount: '-11.00', bookingDate: '2026-03-12'}),
			await synced({amount: '-13.00', bookingDate: '2026-03-09'}),
			await synced({amount: '-13.00', bookingDate: '2026-03-11'}),
		];
		// The only row near the file's -17.00, but its bank reference names another payment.
		const otherReference = await synced({
			amount: '-17.00',
			bookingDate: '2026-03-12',
			entryReference: 'BANK-REF-8',
		});
		const storedIds = [byReference, byBalance, sameDay, nearby, ...doubtfulCandidates, otherReference].map(
			({id}) => id,
		);
		const stored = () => transactions.find({where: {id: In(storedIds)}, order: {id: 'ASC'}});
		const storedBefore = await stored();
		const storedById = new Map(storedBefore.map((row) => [row.id, row]));
		const connectionBefore = await connections.findOneByOrFail({id: connection.id});
		const accountBefore = await bankAccounts.findOneByOrFail({id: account.id});
		const entry = (amount: string, bookingDate: string, reference: string) => ({
			amount,
			bookingDate,
			reference,
			info: `Example Shop ${reference}`,
		});
		const statement = Buffer.from(
			camt053([
				{
					sequence: '1',
					entries: [
						entry('20.00', '2026-03-10', 'BANK-REF-1'),
						entry('5.00', '2026-03-10', 'FILE-REF-3'),
						entry('5.00', '2026-03-10', 'FILE-REF-3B'),
						entry('7.00', '2026-03-11', 'FILE-REF-4'),
						entry('9.00', '2026-03-10', 'FILE-REF-5'),
						entry('11.00', '2026-03-10', 'FILE-REF-6'),
						entry('13.00', '2026-03-10', 'FILE-REF-7'),
						entry('17.00', '2026-03-10', 'FILE-REF-8'),
					],
				},
				// One entry between an opening and a closing balance carries its balance after.
				{
					sequence: '2',
					opening: '500.00',
					closing: '470.00',
					entries: [entry('30.00', '2026-03-09', 'FILE-REF-2')],
				},
			]),
		);

		const imported = await drop(agent, [statement]).expect(201);

		expect(imported.body).toMatchObject({
			rowsParsed: 9,
			rowsAdded: 2,
			rowsAlreadyPresent: 4,
			rowsMatchedByReference: 1,
			rowsMatchedByBalance: 1,
			rowsMatchedByDate: 2,
			rowsDoubtful: 3,
			accounts: [{id: account.id, name: 'Main account', currency: 'EUR', created: false}],
		} satisfies Partial<BankImportSummary>);
		const added = await transactions.find({where: {importId: imported.body.id}, order: {entryReference: 'ASC'}});
		expect(added.map(({entryReference, amount}) => [entryReference, amount])).toEqual([
			['FILE-REF-3B', '-5.00000000'],
			['FILE-REF-5', '-9.00000000'],
		]);
		// The added look-alike of the same-day row shares its identity group as a row of its own; no stored row changed.
		expect(added[0]).toMatchObject({stableIdentityGroupKey: storedById.get(sameDay.id)!.stableIdentityGroupKey});
		expect(added[0].stableIdentityKey).not.toBe(storedById.get(sameDay.id)!.stableIdentityKey);
		expect(await stored()).toEqual(storedBefore);
		expect(await connections.findOneByOrFail({id: connection.id})).toEqual(connectionBefore);
		expect(await bankAccounts.findOneByOrFail({id: account.id})).toEqual(accountBefore);
		expect(await fixtures.balances.countBy({bankAccountId: account.id})).toBe(0);
		expect(await fileConnection(owner)).toBeNull();

		const again = await drop(agent, [statement]).expect(201);
		expect(again.body).toMatchObject({
			rowsAdded: 0,
			rowsAlreadyPresent: 6,
			rowsMatchedByReference: 3,
			rowsMatchedByBalance: 1,
			rowsMatchedByDate: 2,
			rowsDoubtful: 3,
		});
		await agent.delete(`/bank-imports/${again.body.id}`).set('Origin', ORIGIN).expect(204);
		expect(await doubtfulRows.countBy({importId: again.body.id})).toBe(0);

		const listed = await agent.get(`/bank-imports/${imported.body.id}/doubtful-rows`).expect(200);
		const candidate = ({id}: BankTransaction) => {
			const row = storedById.get(id)!;
			return {
				id,
				transactionDate: null,
				bookingDate: row.bookingDate,
				valueDate: row.valueDate,
				amount: row.amount,
				currency: 'EUR',
				displayDescription: row.displayDescription,
				counterpartyName: null,
			};
		};
		const listedRows = [...(listed.body as Array<{id: string; row: {bankReference: string}}>)].sort((left, right) =>
			left.row.bankReference.localeCompare(right.row.bankReference),
		);
		expect(listedRows).toEqual([
			{
				id: expect.any(String),
				bankAccountId: account.id,
				row: expect.objectContaining({
					amount: '-11.00',
					bookingDate: '2026-03-10',
					bankReference: 'FILE-REF-6',
				}),
				candidates: doubtfulCandidates.slice(0, 2).map(candidate),
			},
			{
				id: expect.any(String),
				bankAccountId: account.id,
				row: expect.objectContaining({
					amount: '-13.00',
					bookingDate: '2026-03-10',
					bankReference: 'FILE-REF-7',
				}),
				candidates: doubtfulCandidates.slice(2).map(candidate),
			},
			{
				id: expect.any(String),
				bankAccountId: account.id,
				row: expect.objectContaining({
					amount: '-17.00',
					bookingDate: '2026-03-10',
					bankReference: 'FILE-REF-8',
				}),
				candidates: [candidate(otherReference)],
			},
		]);
		const [asNew, asDuplicate, asNewDespiteNearby] = listedRows;
		const resolve = (rowId: string, body: object) =>
			agent
				.post(`/bank-imports/${imported.body.id}/doubtful-rows/${rowId}/resolve`)
				.set('Origin', ORIGIN)
				.send(body);

		await resolve(asDuplicate.id, {decision: 'duplicate', transactionId: doubtfulCandidates[0].id}).expect(400);
		await resolve(asDuplicate.id, {decision: 'duplicate'}).expect(400);
		const afterNew = await resolve(asNew.id, {decision: 'new'}).expect(200);
		expect(afterNew.body).toMatchObject({rowsAdded: 3, rowsAlreadyPresent: 4, rowsDoubtful: 2});
		const afterDuplicate = await resolve(asDuplicate.id, {
			decision: 'duplicate',
			transactionId: doubtfulCandidates[3].id,
		}).expect(200);
		expect(afterDuplicate.body).toMatchObject({rowsAdded: 3, rowsAlreadyPresent: 5, rowsDoubtful: 1});
		const afterNewDespiteNearby = await resolve(asNewDespiteNearby.id, {decision: 'new'}).expect(200);
		expect(afterNewDespiteNearby.body).toMatchObject({rowsAdded: 4, rowsAlreadyPresent: 5, rowsDoubtful: 0});
		await resolve(asNew.id, {decision: 'new'}).expect(409);
		await agent.get(`/bank-imports/${imported.body.id}/doubtful-rows`).expect(200, []);
		expect(
			(await transactions.find({where: {importId: imported.body.id}}))
				.map(({entryReference}) => entryReference)
				.sort(),
		).toEqual(['FILE-REF-3B', 'FILE-REF-5', 'FILE-REF-6', 'FILE-REF-8']);
		expect(await stored()).toEqual(storedBefore);

		await agent.delete(`/bank-imports/${imported.body.id}`).set('Origin', ORIGIN).expect(204);

		expect(await transactions.find({where: {bankAccountId: account.id}, order: {id: 'ASC'}})).toEqual(storedBefore);
		expect(await bankAccounts.findOneByOrFail({id: account.id})).toEqual(accountBefore);
	});

	it('keeps doubtful rows and their decisions to the owner', async () => {
		const {owner, agent} = await createOwner();
		const other = await createOwner();
		const account = await fixtures.createBankAccount(await fixtures.createConnection(owner), {iban: EXAMPLE_IBAN});
		await fixtures.createTransactions(account, [
			{amount: '-11.00', bookingDate: '2026-03-01'},
			{amount: '-11.00', bookingDate: '2026-03-03'},
		]);
		const imported = await drop(agent, [
			Buffer.from(camt053([{entries: [{amount: '11.00', bookingDate: '2026-03-02', reference: 'R-1'}]}])),
		]).expect(201);
		const [row] = (await agent.get(`/bank-imports/${imported.body.id}/doubtful-rows`).expect(200)).body as Array<{
			id: string;
		}>;

		await other.agent.get(`/bank-imports/${imported.body.id}/doubtful-rows`).expect(404);
		await other.agent
			.post(`/bank-imports/${imported.body.id}/doubtful-rows/${row.id}/resolve`)
			.set('Origin', ORIGIN)
			.send({decision: 'new'})
			.expect(404);
		await agent
			.post(`/bank-imports/${imported.body.id}/doubtful-rows/${row.id}/resolve`)
			.set('Origin', 'https://other.example.test')
			.send({decision: 'new'})
			.expect(403);

		expect(await doubtfulRows.findOneByOrFail({id: row.id})).toMatchObject({resolution: null});
	});

	it('keeps an imported-files account while another import still holds an open doubtful row for it', async () => {
		const {agent} = await createOwner();
		const first = await drop(agent, [
			Buffer.from(
				camt053([
					{
						entries: [
							{amount: '11.00', bookingDate: '2026-03-01', reference: 'R-1'},
							{amount: '11.00', bookingDate: '2026-03-03', reference: 'R-2'},
						],
					},
				]),
			),
		]).expect(201);
		const second = await drop(agent, [
			Buffer.from(camt053([{entries: [{amount: '11.00', bookingDate: '2026-03-02', reference: 'R-3'}]}])),
		]).expect(201);
		expect(second.body).toMatchObject({rowsAdded: 0, rowsDoubtful: 1});

		await agent.delete(`/bank-imports/${first.body.id}`).set('Origin', ORIGIN).expect(204);

		const [row] = (await agent.get(`/bank-imports/${second.body.id}/doubtful-rows`).expect(200)).body as Array<{
			id: string;
			candidates: unknown[];
		}>;
		expect(row.candidates).toEqual([]);
		const resolved = await agent
			.post(`/bank-imports/${second.body.id}/doubtful-rows/${row.id}/resolve`)
			.set('Origin', ORIGIN)
			.send({decision: 'new'})
			.expect(200);
		expect(resolved.body).toMatchObject({rowsAdded: 1, rowsDoubtful: 0});
		expect(await transactions.countBy({importId: second.body.id})).toBe(1);
	});

	it('imports into the account the request names, and refuses an account the drop does not belong to', async () => {
		const {owner, agent} = await createOwner();
		const other = await createOwner();
		// An old and a new connection to the same bank both hold the account.
		const [oldAccount, newAccount] = [
			await fixtures.createBankAccount(await fixtures.createConnection(owner, {status: 'EXPIRED'}), {
				iban: EXAMPLE_IBAN,
			}),
			await fixtures.createBankAccount(await fixtures.createConnection(owner), {
				identificationHash: EXAMPLE_IBAN_HASH,
			}),
		];
		const otherIbanAccount = await fixtures.createBankAccount(await fixtures.createConnection(owner), {
			iban: OTHER_EXAMPLE_IBAN,
		});
		const dollarAccount = await fixtures.createBankAccount(await fixtures.createConnection(owner), {
			currency: 'USD',
		});
		const othersAccount = await fixtures.createBankAccount(await fixtures.createConnection(other.owner), {
			iban: EXAMPLE_IBAN,
		});

		const ambiguous = await drop(agent, [STATEMENT_FILES[0]]).expect(409);
		expect(ambiguous.body).toMatchObject({code: 'ambiguous_target_account', file: null});

		const named = await drop(agent, [STATEMENT_FILES[0]]).field('bankAccountId', newAccount.id).expect(201);
		expect(named.body).toMatchObject({rowsAdded: 3, accounts: [{id: newAccount.id, created: false}]});
		expect(await transactions.countBy({bankAccountId: newAccount.id})).toBe(3);
		expect(await transactions.countBy({bankAccountId: oldAccount.id})).toBe(0);

		for (const [bankAccountId, files] of [
			[othersAccount.id, [STATEMENT_FILES[2]]],
			[oldAccount.id, [STATEMENT_FILES[2], OTHER_STATEMENT]],
			[dollarAccount.id, [STATEMENT_FILES[2]]],
			[otherIbanAccount.id, [STATEMENT_FILES[2]]],
		] as const) {
			const refused = await drop(agent, [...files])
				.field('bankAccountId', bankAccountId)
				.expect(422);
			expect(refused.body).toMatchObject({code: 'target_account_mismatch', file: null});
		}
		await drop(agent, [STATEMENT_FILES[2]]).field('bankAccountId', 'not-a-uuid').expect(400);
		expect(await imports.countBy({accountId: owner.id})).toBe(1);
		expect(await transactions.countBy({bankAccountId: othersAccount.id})).toBe(0);
	});

	it('waits for a running sync of the account and refuses an import or undo while it keeps running', async () => {
		const {owner, agent} = await createOwner();
		const connection = await fixtures.createConnection(owner);
		await fixtures.createBankAccount(connection, {iban: EXAMPLE_IBAN});
		const imported = await drop(agent, [STATEMENT_FILES[0]]).expect(201);
		const lock = await app.get(BankingConnectionLockService).acquire(connection.id);

		try {
			const busyImport = await drop(agent, [STATEMENT_FILES[2]]).expect(409);
			expect(busyImport.body).toMatchObject({code: 'account_busy'});
			const busyUndo = await agent.delete(`/bank-imports/${imported.body.id}`).set('Origin', ORIGIN).expect(409);
			expect(busyUndo.body).toMatchObject({code: 'account_busy'});
		} finally {
			lock.stop();
			await lock.release();
		}

		expect(await imports.countBy({accountId: owner.id})).toBe(1);
		expect(await transactions.countBy({importId: imported.body.id})).toBe(3);
	});

	it('lets a sync take over the only imported twin of a row it delivers, keeping its manual category, so undo leaves it', async () => {
		const {owner, agent} = await createOwner();
		const connection = await fixtures.createConnection(owner, {
			providerSessionId: app.get(BankingEncryptionService).encrypt('file-import-adoption-session'),
			consentValidUntil: new Date(Date.now() + 60 * 60 * 1000),
		});
		const [account, plainAccount] = await fixtures.createBankAccounts(connection, [
			{iban: EXAMPLE_IBAN, providerAccountId: 'adoption-account'},
			{iban: OTHER_EXAMPLE_IBAN, providerAccountId: 'adoption-plain-account'},
		]);
		const imported = await drop(agent, [
			Buffer.from(
				camt053([
					{
						entries: [
							{
								amount: '25.00',
								bookingDate: '2026-03-20',
								reference: 'FILE-ADOPT-1',
								info: 'Example Shop',
							},
							{
								amount: '40.00',
								bookingDate: '2026-03-21',
								reference: 'FILE-ADOPT-2',
								info: 'Example Cafe',
							},
							{
								amount: '15.00',
								bookingDate: '2026-03-21',
								reference: 'FILE-ADOPT-3',
								info: 'Example Kiosk',
							},
							{
								amount: '15.00',
								bookingDate: '2026-03-21',
								reference: 'FILE-ADOPT-4',
								info: 'Example Kiosk',
							},
							{
								amount: '50.00',
								bookingDate: '2026-03-22',
								reference: 'FILE-ADOPT-5',
								info: 'Example Garage',
							},
							{
								amount: '70.00',
								bookingDate: '2026-03-23',
								reference: 'FILE-ADOPT-6',
								info: 'Example Florist',
							},
						],
					},
				]),
			),
		]).expect(201);
		const importedRow = (reference: string) =>
			transactions.findOneByOrFail({importId: imported.body.id, entryReference: reference});
		const twin = await importedRow('FILE-ADOPT-1');
		const kept = await importedRow('FILE-ADOPT-2');
		const lookAlikes = [await importedRow('FILE-ADOPT-3'), await importedRow('FILE-ADOPT-4')];
		const held = await importedRow('FILE-ADOPT-5');
		const otherPayment = await importedRow('FILE-ADOPT-6');
		await transactions.update(
			{id: twin.id},
			{category: 'GROCERIES', categorySource: 'MANUAL', categoryStatus: 'COMPLETED'},
		);
		await transactions.update({id: held.id}, {categoryStatus: 'PROCESSING'});
		// A stored row of an account without imports: a look-alike a few days off stays separate.
		const plainRow = await fixtures.createTransaction(plainAccount, {
			amount: '-60.00',
			bookingDate: '2026-03-21',
			valueDate: '2026-03-21',
		});
		const delivered: Record<string, EnableBankingTransaction[]> = {
			'adoption-account': [
				// Without a bank reference of its own, the sync row matches the imported row on amount and day.
				{
					providerTransactionId: 'provider-adopt-1',
					amount: '25.00',
					currency: 'EUR',
					creditDebitIndicator: 'DBIT',
					status: 'BOOK',
					transactionDate: '2026-03-19',
					bookingDate: '2026-03-20',
					valueDate: '2026-03-20',
					description: 'Example Shop',
				},
				{
					providerTransactionId: 'provider-new-1',
					amount: '3.00',
					currency: 'EUR',
					creditDebitIndicator: 'DBIT',
					status: 'BOOK',
					transactionDate: '2026-03-22',
					bookingDate: '2026-03-22',
					valueDate: '2026-03-22',
					description: 'Example Bakery',
				},
				{
					providerTransactionId: 'provider-look-alike-1',
					amount: '15.00',
					currency: 'EUR',
					creditDebitIndicator: 'DBIT',
					status: 'BOOK',
					transactionDate: '2026-03-20',
					bookingDate: '2026-03-21',
					valueDate: '2026-03-21',
					description: 'Example Kiosk',
				},
				{
					providerTransactionId: 'provider-held-1',
					amount: '50.00',
					currency: 'EUR',
					creditDebitIndicator: 'DBIT',
					status: 'BOOK',
					transactionDate: '2026-03-21',
					bookingDate: '2026-03-22',
					valueDate: '2026-03-22',
					description: 'Example Garage',
				},
				{
					providerTransactionId: 'provider-other-reference-1',
					entryReference: 'PROVIDER-REF-6',
					amount: '70.00',
					currency: 'EUR',
					creditDebitIndicator: 'DBIT',
					status: 'BOOK',
					transactionDate: '2026-03-23',
					bookingDate: '2026-03-23',
					valueDate: '2026-03-23',
					description: 'Example Florist',
				},
			],
			'adoption-plain-account': [
				{
					providerTransactionId: 'provider-plain-1',
					amount: '60.00',
					currency: 'EUR',
					creditDebitIndicator: 'DBIT',
					status: 'BOOK',
					transactionDate: '2026-03-23',
					bookingDate: '2026-03-23',
					valueDate: '2026-03-23',
					description: 'Example Market',
				},
			],
		};
		const client = app.get(EnableBankingClient);
		const spies = [
			jest.spyOn(client, 'getSessionAccounts').mockResolvedValue({
				status: 'AUTHORIZED',
				accountIds: ['adoption-account', 'adoption-plain-account'],
			}),
			jest.spyOn(client, 'getAccountBalances').mockResolvedValue([]),
			jest
				.spyOn(client, 'getAccountTransactions')
				.mockImplementation(async (providerAccountId) => delivered[providerAccountId] ?? []),
		];
		const synchronize = async () => {
			await connections.update(connection.id, {nextSyncAt: new Date(Date.now() - 1), syncStatus: 'QUEUED'});
			return app.get(BankingSyncService).synchronizeAutomatically(connection.id);
		};

		try {
			expect(await synchronize()).toMatchObject({status: 'SUCCEEDED', transactionsAdded: 4});
			const adopted = await transactions.findOneByOrFail({id: twin.id});
			expect(adopted).toMatchObject({
				importId: null,
				providerTransactionId: 'provider-adopt-1',
				transactionDate: '2026-03-19',
				bookingDate: '2026-03-20',
				amount: '-25.00000000',
				category: 'GROCERIES',
				categorySource: 'MANUAL',
			});
			expect(adopted.stableIdentityKey).not.toBe(twin.stableIdentityKey);
			// Two imported look-alikes give the sync row two candidates, so it is inserted next to them.
			expect(await transactions.countBy({importId: imported.body.id, id: In(lookAlikes.map(({id}) => id))})).toBe(
				2,
			);
			// The row the worker holds keeps its file fields and its import until a sync can write it.
			expect(await transactions.findOneByOrFail({id: held.id})).toMatchObject({
				importId: imported.body.id,
				providerTransactionId: null,
			});
			// The imported row of the same amount and day carries another bank reference: another payment, kept apart.
			expect(await transactions.findOneByOrFail({id: otherPayment.id})).toMatchObject({
				importId: imported.body.id,
				providerTransactionId: null,
				entryReference: 'FILE-ADOPT-6',
			});
			expect(await transactions.countBy({bankAccountId: account.id})).toBe(9);
			expect(await transactions.countBy({bankAccountId: plainAccount.id})).toBe(2);
			expect(await transactions.findOneByOrFail({id: plainRow.id})).toMatchObject({
				providerTransactionId: null,
				bookingDate: '2026-03-21',
				amount: '-60.00000000',
			});

			// The next sync finds the adopted row by its new identity, and takes over the row the worker released.
			await transactions.update({id: held.id}, {categoryStatus: 'COMPLETED'});
			expect(await synchronize()).toMatchObject({status: 'SUCCEEDED', transactionsAdded: 0});
			expect(await transactions.findOneByOrFail({id: held.id})).toMatchObject({
				importId: null,
				providerTransactionId: 'provider-held-1',
			});
		} finally {
			for (const spy of spies) spy.mockRestore();
		}

		await agent.delete(`/bank-imports/${imported.body.id}`).set('Origin', ORIGIN).expect(204);

		expect(await transactions.findOneBy({id: kept.id})).toBeNull();
		expect(
			(await transactions.find({where: {bankAccountId: account.id}, order: {amount: 'ASC'}})).map(
				({id, providerTransactionId}) => [id, providerTransactionId],
			),
		).toEqual([
			[expect.any(String), 'provider-other-reference-1'],
			[held.id, 'provider-held-1'],
			[twin.id, 'provider-adopt-1'],
			[expect.any(String), 'provider-look-alike-1'],
			[expect.any(String), 'provider-new-1'],
		]);
	});

	it.each([
		{
			name: 'a file that is not a statement',
			files: () => [ARCHIVE, Buffer.from('Date,Amount\n2026-03-02,1.00\n')],
			status: 415,
			code: 'unsupported_format',
			file: 2,
		},
		{
			name: 'an old binary Excel file',
			files: () => [Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(504)])],
			status: 415,
			code: 'legacy_xls_not_supported',
			file: 1,
		},
		{
			name: 'XML that declares entities',
			files: () => [
				Buffer.from(
					camt053([{entries: [{amount: '1.00', info: '&a;'}]}]).replace(
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<?xml version="1.0"?><!DOCTYPE Document [<!ENTITY a "example">]>',
					),
				),
			],
			status: 422,
			code: 'parse_failed',
			file: 1,
		},
		{
			name: 'an archive that unpacks past the limit',
			files: () => [
				createZip([
					{
						name: 'statement.xml',
						content: Buffer.alloc(0),
						deflated: deflateRawSync(Buffer.alloc(60 * 1024 * 1024)),
						declaredSize: 100,
					},
				]),
			],
			status: 413,
			code: 'archive_too_large',
			file: 1,
		},
		{
			name: 'a file over 10 MB',
			files: () => [ARCHIVE, Buffer.alloc(10 * 1024 * 1024 + 1, 0x20)],
			status: 413,
			code: 'file_too_large',
			file: 2,
		},
		{
			name: 'more than 20 files',
			files: () => Array.from({length: 21}, () => ARCHIVE),
			status: 422,
			code: 'too_many_files',
			file: null,
		},
	])('refuses $name and writes nothing', async ({files, status, code, file}) => {
		const {owner, agent} = await createOwner();

		const response = await drop(agent, files()).expect(status);

		expect(response.body).toMatchObject({code, file});
		expect(await fileConnection(owner)).toBeNull();
		expect(await imports.countBy({accountId: owner.id})).toBe(0);
	});

	it('asks for at least one file', async () => {
		const {agent} = await createOwner();

		await agent.post('/bank-imports').set('Origin', ORIGIN).send({}).expect(400);
	});

	it('refuses text fields next to the files', async () => {
		const {owner, agent} = await createOwner();

		await drop(agent, [ARCHIVE]).field('note', 'example').expect(400);

		expect(await imports.countBy({accountId: owner.id})).toBe(0);
	});

	it('refuses an upload from another site', async () => {
		const {owner, agent} = await createOwner();

		await agent
			.post('/bank-imports')
			.set('Origin', 'https://other.example.test')
			.attach('files', ARCHIVE, 'a.zip')
			.expect(403);

		expect(await imports.countBy({accountId: owner.id})).toBe(0);
	});
});
