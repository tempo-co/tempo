import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import type {BankImportPreview, BankImportSummary} from '@wisp/contracts';
import {readFileSync} from 'node:fs';
import {Server} from 'node:net';
import {join} from 'node:path';
import TestAgent from 'supertest/lib/agent';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BankImportDoubtfulRow} from '@modules/file-import/bank-import-doubtful-row.entity';
import {BankImportLayoutMiss} from '@modules/file-import/bank-import-layout-miss.entity';
import {BankImport} from '@modules/file-import/bank-import.entity';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {EXAMPLE_IBAN} from '../../fixtures/statement-file.fixture';
import {enableFileImportE2e, getApp} from '../../setup/e2e.setup';
import {createVerifiedAccount} from '../../utils/auth-utils';
import {MAILPIT_API_URL} from '../../utils/email-utils';

enableFileImportE2e();

const ORIGIN = 'http://localhost:5173';
const FIXTURES = join(__dirname, '../../fixtures/file-import');
// Seven rows of one account (EXAMPLE_IBAN) from 2 to 4 March 2026, as a CAMT.053 archive.
const ARCHIVE = readFileSync(join(FIXTURES, 'camt053-synthetic.zip'));
// Eight payments of one account from 2 to 5 March 2026, in ABN AMRO's CAMT.053, MT940 and TXT exports.
const CAMT_FILES = ['020326', '030326', '040326', '050326'].map((day) =>
	readFileSync(join(FIXTURES, `0417164300_99999999_${day}000000.xml`)),
);
const MT940_FILE = readFileSync(join(FIXTURES, 'MT940260305120000.STA'));
const TXT_FILE = readFileSync(join(FIXTURES, 'TXT260305120000.TAB'));
// One Revolut export with EUR and RON rows: two accounts of a file that names none.
const REVOLUT_CSV = readFileSync(join(FIXTURES, 'account-statement_2026-03-01_2026-03-05_en-gb_a0b1c2.csv'));

describe('Bank import preview', () => {
	// Each drop is parsed in a child process, as the import spec's drops are.
	jest.setTimeout(60_000);
	let app: INestApplication;
	let fixtures: BankingFixtures;
	let accounts: Repository<Account>;
	let imports: Repository<BankImport>;
	let doubtfulRows: Repository<BankImportDoubtfulRow>;
	let misses: Repository<BankImportLayoutMiss>;

	beforeAll(() => {
		app = getApp();
		fixtures = new BankingFixtures(app);
		accounts = app.get(getRepositoryToken(Account));
		imports = app.get(getRepositoryToken(BankImport));
		doubtfulRows = app.get(getRepositoryToken(BankImportDoubtfulRow));
		misses = app.get(getRepositoryToken(BankImportLayoutMiss));
	});

	async function createOwner(): Promise<{owner: Account; agent: TestAgent}> {
		const fresh = await createVerifiedAccount(app.getHttpServer() as Server, MAILPIT_API_URL);
		return {owner: await accounts.findOneByOrFail({id: fresh.id}), agent: fresh.agent};
	}

	function send(agent: TestAgent, path: string, files: Buffer[], fields: Record<string, string> = {}) {
		const upload = agent.post(path).set('Origin', ORIGIN);
		for (const [name, value] of Object.entries(fields)) upload.field(name, value);
		for (const [index, file] of files.entries()) upload.attach('files', file, `upload-${index}.bin`);
		return upload;
	}

	/** Everything an import writes for the owner, counted. */
	async function written(owner: Account) {
		const connections = await fixtures.connections.countBy({accountId: owner.id});
		const ownImports = await imports.findBy({accountId: owner.id});
		return {
			connections,
			accounts: await fixtures.bankAccounts.countBy({bankConnection: {accountId: owner.id}}),
			transactions: await fixtures.transactions
				.createQueryBuilder('transaction')
				.innerJoin('transaction.bankAccount', 'bankAccount')
				.innerJoin('bankAccount.bankConnection', 'connection')
				.where('connection.accountId = :ownerId', {ownerId: owner.id})
				.getCount(),
			imports: ownImports.length,
			doubtfulRows: (await Promise.all(ownImports.map(({id}) => doubtfulRows.countBy({importId: id})))).reduce(
				(total, count) => total + count,
				0,
			),
			misses: await misses.countBy({accountId: owner.id}),
		};
	}

	it("lists the accounts a drop would create or write to, with their rows and days, writing nothing, and the archive's import goes to the account it listed", async () => {
		const {owner, agent} = await createOwner();
		const nothing = await written(owner);

		const preview = await send(agent, '/bank-imports/preview', [ARCHIVE, REVOLUT_CSV], {bankId: 'abn-amro'}).expect(
			200,
		);
		expect(preview.body).toEqual({
			rowCount: expect.any(Number),
			dateFrom: '2026-03-01',
			dateTo: '2026-03-05',
			accounts: [
				{
					id: null,
					name: 'NL91 ABNA 0417 1643 00',
					alias: null,
					details: null,
					cashAccountType: null,
					maskedIdentifier: null,
					currency: 'EUR',
					bankName: null,
					imported: true,
					rowCount: 7,
					dateFrom: '2026-03-02',
					dateTo: '2026-03-04',
				},
				expect.objectContaining({
					id: null,
					name: 'Revolut EUR',
					currency: 'EUR',
					bankName: 'Revolut',
					imported: true,
				}),
				expect.objectContaining({
					id: null,
					name: 'Revolut RON',
					currency: 'RON',
					bankName: 'Revolut',
					imported: true,
				}),
			],
		});
		const {rowCount, accounts: found} = preview.body as BankImportPreview;
		expect(rowCount).toBe(found.reduce((total, account) => total + account.rowCount, 0));
		expect(await written(owner)).toEqual(nothing);

		const imported = await send(agent, '/bank-imports', [ARCHIVE], {bankId: 'abn-amro'}).expect(201);
		const [account] = (imported.body as BankImportSummary).accounts;
		expect(account).toMatchObject({name: 'NL91 ABNA 0417 1643 00', created: true});
		await agent
			.patch(
				`/bank-connections/${(await fixtures.connections.findOneByOrFail({accountId: owner.id})).id}/accounts/${account.id}`,
			)
			.set('Origin', ORIGIN)
			.send({alias: 'Example current account'})
			.expect(200);

		const after = await written(owner);
		const again = await send(agent, '/bank-imports/preview', [ARCHIVE]).expect(200);
		expect(again.body).toEqual({
			rowCount: 7,
			dateFrom: '2026-03-02',
			dateTo: '2026-03-04',
			accounts: [
				{
					id: account.id,
					name: 'NL91 ABNA 0417 1643 00',
					alias: 'Example current account',
					details: null,
					cashAccountType: null,
					maskedIdentifier: null,
					currency: 'EUR',
					bankName: null,
					imported: true,
					rowCount: 7,
					dateFrom: '2026-03-02',
					dateTo: '2026-03-04',
				},
			],
		} satisfies BankImportPreview);
		expect(await written(owner)).toEqual(after);
	});

	it("finds the synced account a statement names, and only the owner's", async () => {
		const {owner, agent} = await createOwner();
		const connection = await fixtures.createConnection(owner, {aspspName: 'Example Bank'});
		const synced = await fixtures.createBankAccount(connection, {iban: EXAMPLE_IBAN});
		const other = await createOwner();

		const preview = await send(agent, '/bank-imports/preview', [ARCHIVE]).expect(200);
		expect((preview.body as BankImportPreview).accounts).toEqual([
			expect.objectContaining({id: synced.id, bankName: 'Example Bank', imported: false, rowCount: 7}),
		]);

		// Another owner's drop of the same file finds none of the owner's accounts, and cannot name one.
		const nothing = await written(other.owner);
		const theirs = await send(other.agent, '/bank-imports/preview', [ARCHIVE]).expect(200);
		expect((theirs.body as BankImportPreview).accounts).toEqual([
			expect.objectContaining({id: null, imported: true}),
		]);
		const named = await send(other.agent, '/bank-imports/preview', [ARCHIVE], {bankAccountId: synced.id}).expect(
			422,
		);
		expect(named.body).toMatchObject({code: 'target_account_mismatch', file: null});
		expect(await written(other.owner)).toEqual(nothing);
	});

	it('refuses what the import refuses, with the same code and file', async () => {
		const {agent} = await createOwner();
		const refused = await send(agent, '/bank-imports/preview', [
			ARCHIVE,
			Buffer.from('Example notes\nmore notes\n'),
		]).expect(415);
		expect(refused.body).toMatchObject({code: 'unsupported_format', file: 2});
		await send(agent, '/bank-imports/preview', []).expect(400);
	});

	it('counts a payment that several export formats state once, as the import adds it once', async () => {
		const {agent} = await createOwner();
		const drop = [TXT_FILE, MT940_FILE, ...CAMT_FILES];
		const preview = (await send(agent, '/bank-imports/preview', drop).expect(200)).body as BankImportPreview;
		expect(preview.rowCount).toBe(8);
		expect(preview.accounts).toHaveLength(1);
		expect(preview.accounts[0]).toMatchObject({id: null, rowCount: 8});

		const summary = (await send(agent, '/bank-imports', drop).expect(201)).body as BankImportSummary;
		expect(summary).toMatchObject({rowsParsed: 24, rowsAdded: 8});
	});
});
