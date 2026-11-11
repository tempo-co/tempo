import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import type {BankImportSummary} from '@tempo/contracts';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Server} from 'node:net';
import {join} from 'node:path';
import {deflateRawSync} from 'node:zlib';
import TestAgent from 'supertest/lib/agent';
import {Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {Account} from '@modules/account/account.entity';
import {BankConnectionAlertService} from '@modules/banking/alerts/bank-connection-alert.service';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {BankingSyncQueueService} from '@modules/banking/services/banking-sync-queue.service';
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
// The archive's 7 rows in booking order: [booking date, value date, amount, bank reference, balance after].
const ARCHIVE_ROWS = [
	['2026-03-02', '2026-03-01', '-12.50000000', '6061000000000001', '987.50000000'],
	['2026-03-02', '2026-03-02', '-850.00000000', '6061000000000002', '137.50000000'],
	['2026-03-02', '2026-03-02', '2500.00000000', '6061000000000003', '2637.50000000'],
	['2026-03-04', '2026-03-03', '-12.50000000', '6063000000000001', '2625.00000000'],
	['2026-03-04', '2026-03-03', '-12.50000000', '6063000000000002', '2612.50000000'],
	['2026-03-04', '2026-03-04', '-39.99000000', '6063000000000003', '2572.51000000'],
	['2026-03-04', '2026-03-04', '-1.95000000', '6063000000000004', '2570.56000000'],
];

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

	beforeAll(() => {
		app = getApp();
		httpServer = app.getHttpServer();
		fixtures = new BankingFixtures(app);
		accounts = app.get(getRepositoryToken(Account));
		connections = fixtures.connections;
		bankAccounts = fixtures.bankAccounts;
		transactions = fixtures.transactions;
		imports = app.get(getRepositoryToken(BankImport));
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
		{
			name: 'its IBAN',
			values: {iban: EXAMPLE_IBAN},
		},
		{
			name: 'its identification hash',
			values: {
				identificationHash: [
					Buffer.from(
						JSON.stringify([
							['account', 'account_id', 'iban'],
							['account', 'currency'],
						]),
					).toString('base64url'),
					createHash('sha256').update(`[\n"${EXAMPLE_IBAN}",\n"EUR"\n]`).digest('base64url'),
				].join('.'),
			},
		},
	])('refuses a statement for an account bank sync already holds, recognized by $name', async ({values}) => {
		const {owner, agent} = await createOwner();
		await fixtures.createBankAccount(await fixtures.createConnection(owner), values);

		const response = await drop(agent, [ARCHIVE]).expect(409);

		expect(response.body).toMatchObject({code: 'synced_account_not_supported_yet', file: null});
		expect(await fileConnection(owner)).toBeNull();
		expect(await imports.countBy({accountId: owner.id})).toBe(0);
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
