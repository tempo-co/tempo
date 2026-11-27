import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import type {BankImportLayoutProposal as ProposalResponse} from '@wisp/contracts';
import {readFileSync} from 'node:fs';
import {Server} from 'node:net';
import {join} from 'node:path';
import TestAgent from 'supertest/lib/agent';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {BankImportLayoutMiss} from '@modules/file-import/bank-import-layout-miss.entity';
import {BankImportLayoutProposal} from '@modules/file-import/bank-import-layout-proposal.entity';
import {BankImportLayout} from '@modules/file-import/bank-import-layout.entity';
import {LayoutMapper, LayoutMapperError} from '@modules/file-import/mapper/layout-mapper';
import {LayoutAnswer} from '@modules/file-import/mapper/layout-mapper.contract';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {createWorkbook, createZip} from '../../fixtures/statement-file.fixture';
import {enableFileImportMapperE2e, getApp} from '../../setup/e2e.setup';
import {createVerifiedAccount} from '../../utils/auth-utils';
import {MAILPIT_API_URL} from '../../utils/email-utils';

enableFileImportMapperE2e();
// Replaced before the app starts, so no test reaches a model.
const mapLayout = jest.spyOn(LayoutMapper.prototype, 'mapLayout');

const ORIGIN = 'http://localhost:5173';
const FIXTURES = join(__dirname, '../../fixtures/file-import');
const DEBIT_CREDIT_CSV = readFileSync(join(FIXTURES, 'debit-credit-synthetic.csv'));
const BALANCE_CSV = readFileSync(join(FIXTURES, 'balance-synthetic.csv'));
const HEADERLESS_CSV = readFileSync(join(FIXTURES, 'headerless-synthetic.csv'));
const WORKBOOK = createWorkbook([
	['Example statement'],
	['Date', 'Details', 'Amount'],
	[46083, 'Example Shop', -12.5],
	[46084, 'Example Employer', 2500],
]);
/** Everything of the debit and credit file that is not its header. */
const DEBIT_CREDIT_CONTENT = ['Example', 'Beispiel', 'Miete', 'Gehalt', '2026', '12,50', '2.500', 'DE89', '3704'];

const ANSWER: Record<'debitCredit' | 'balance' | 'headerless' | 'workbook', LayoutAnswer> = {
	debitCredit: {
		bankName: 'Example Bank',
		dateFormat: 'DD.MM.YYYY',
		bookingDate: 0,
		valueDate: 1,
		transactionDate: null,
		pending: null,
		amount: {kind: 'debitCredit', moneyOutColumn: 4, moneyInColumn: 5},
		decimalMark: ',',
		thousandsSeparator: '.',
		currency: {column: 6},
		balance: null,
		counterpartyName: 2,
		counterpartyAccount: null,
		description: [3],
		account: {line: 1},
	},
	balance: {
		bankName: null,
		dateFormat: 'DD/MM/YYYY',
		bookingDate: 0,
		valueDate: null,
		transactionDate: null,
		pending: null,
		amount: {kind: 'signed', column: 3},
		decimalMark: '.',
		thousandsSeparator: ',',
		currency: null,
		balance: {column: 4, when: 'after'},
		counterpartyName: null,
		counterpartyAccount: null,
		description: [1],
		account: null,
	},
	headerless: {
		bankName: null,
		dateFormat: 'YYYY-MM-DD',
		bookingDate: 0,
		valueDate: null,
		transactionDate: null,
		pending: null,
		amount: {kind: 'signed', column: 1},
		decimalMark: '.',
		thousandsSeparator: null,
		currency: {column: 2},
		balance: null,
		counterpartyName: null,
		counterpartyAccount: null,
		description: [3],
		account: null,
	},
	workbook: {
		bankName: null,
		dateFormat: 'DD/MM/YYYY',
		bookingDate: 0,
		valueDate: null,
		transactionDate: null,
		pending: null,
		amount: {kind: 'signed', column: 2},
		decimalMark: '.',
		thousandsSeparator: null,
		currency: {code: 'EUR'},
		balance: null,
		counterpartyName: null,
		counterpartyAccount: null,
		description: [1],
		account: null,
	},
};

describe('Bank import column mapper', () => {
	jest.setTimeout(60_000);

	let app: INestApplication;
	let httpServer: Server;
	let fixtures: BankingFixtures;
	let accounts: Repository<Account>;
	let proposals: Repository<BankImportLayoutProposal>;
	let layouts: Repository<BankImportLayout>;
	let misses: Repository<BankImportLayoutMiss>;
	let bankAccounts: Repository<BankAccount>;
	let transactions: Repository<BankTransaction>;

	beforeAll(() => {
		app = getApp();
		httpServer = app.getHttpServer() as Server;
		fixtures = new BankingFixtures(app);
		accounts = app.get(getRepositoryToken(Account));
		proposals = app.get(getRepositoryToken(BankImportLayoutProposal));
		layouts = app.get(getRepositoryToken(BankImportLayout));
		misses = app.get(getRepositoryToken(BankImportLayoutMiss));
		bankAccounts = fixtures.bankAccounts;
		transactions = fixtures.transactions;
	});

	beforeEach(() => mapLayout.mockReset());

	async function createOwner(): Promise<{owner: Account; agent: TestAgent}> {
		const fresh = await createVerifiedAccount(httpServer, MAILPIT_API_URL);
		await accounts.update({id: fresh.id}, {baseCurrency: 'EUR'});
		return {owner: await accounts.findOneByOrFail({id: fresh.id}), agent: fresh.agent};
	}

	/** `bankId`: the bank the owner picked, sent ahead of the file. */
	function drop(agent: TestAgent, file: Buffer, {bankId}: {bankId?: string} = {}) {
		const upload = agent.post('/bank-imports').set('Origin', ORIGIN);
		if (bankId !== undefined) upload.field('bankId', bankId);
		return upload.attach('files', file, 'upload-0.bin');
	}

	function propose(agent: TestAgent, file: Buffer, {bankId}: {bankId?: string} = {}) {
		const upload = agent.post('/bank-imports/layout-proposals').set('Origin', ORIGIN);
		if (bankId !== undefined) upload.field('bankId', bankId);
		return upload.attach('files', file, 'upload-0.bin');
	}

	/** The owner's layout misses, oldest first, as stored. */
	async function missesOf(owner: Account) {
		const rows = await misses.find({where: {accountId: owner.id}, order: {createdAt: 'ASC', id: 'ASC'}});
		return rows.map(({bankId, outcome, refusalCode}) => ({bankId, outcome, refusalCode}));
	}

	function confirm(agent: TestAgent, proposalId: string, body: Record<string, unknown>) {
		return agent.post(`/bank-imports/layout-proposals/${proposalId}/confirm`).set('Origin', ORIGIN).send(body);
	}

	/** Proposes and confirms a layout for the file, the model answering `answer`. */
	function banksFor(agent: TestAgent, proposalId: string) {
		return agent.get(`/bank-imports/layout-proposals/${proposalId}/banks`);
	}

	async function saveLayout(agent: TestAgent, file: Buffer, answer: LayoutAnswer, body: Record<string, unknown>) {
		mapLayout.mockResolvedValueOnce(answer);
		const proposal = await propose(agent, file).expect(201);
		return (await confirm(agent, (proposal.body as ProposalResponse).id, body).expect(201)).body as {id: string};
	}

	it("works out a file's columns with one call on a masked sample, saves the confirmed layout for its owner only under the picked bank and imports the same drop with it", async () => {
		const {owner, agent} = await createOwner();
		expect((await agent.get('/bank-imports').expect(200)).body).toEqual({imports: [], mapper: true});
		// GLS Bank is verified, but none of its readers (CAMT.053, the Atruvia CSV) reads this table, so it misses at every step.
		const picked = {bankId: 'gls-bank'};
		expect((await drop(agent, DEBIT_CREDIT_CSV, picked).expect(422)).body).toMatchObject({
			code: 'layout_unknown',
			file: 1,
		});

		mapLayout.mockResolvedValueOnce(ANSWER.debitCredit);
		const proposed = await propose(agent, DEBIT_CREDIT_CSV, picked).expect(201);

		expect(proposed.body).toEqual({
			id: expect.any(String),
			expiresAt: expect.any(String),
			bankName: 'Example Bank',
			currencyNeeded: false,
			defaultCurrency: 'EUR',
			mapping: {
				columns: [
					{field: 'date', column: 1, header: 'Buchungstag'},
					{field: 'valueDate', column: 2, header: 'Valuta'},
					{field: 'moneyOut', column: 5, header: 'Soll'},
					{field: 'moneyIn', column: 6, header: 'Haben'},
					{field: 'currency', column: 7, header: 'Währung'},
					{field: 'counterparty', column: 3, header: 'Auftraggeber/Empfänger'},
					{field: 'description', column: 4, header: 'Verwendungszweck'},
				],
				amount: 'debitCredit',
				direction: null,
				balance: null,
				accountLine: 2,
				dateFormat: 'DD.MM.YYYY',
			},
			dateCheck: null,
			preview: {
				rowCount: 4,
				dateFrom: '2026-03-02',
				dateTo: '2026-03-05',
				firstRows: [
					['2026-03-02', '-12.50', 'Example Shop GmbH', 'Kartenzahlung Example Shop'],
					['2026-03-03', '-850.00', 'Beispiel Vermietung GmbH', 'Miete Maerz'],
					['2026-03-04', '2500.00', 'Example Employer AG', 'Gehalt Maerz'],
					['2026-03-05', '-39.99', 'Example Shop GmbH', 'Kartenzahlung Example Shop'],
				].map(([date, amount, counterparty, description]) => ({
					date,
					amount,
					currency: 'EUR',
					counterparty,
					description,
					balanceAfter: null,
				})),
				lastRows: [],
				totals: [{currency: 'EUR', moneyIn: '2500.00', moneyOut: '902.49'}],
				accounts: ['DE89370400440532013000'],
			},
		});
		expect(Date.parse(proposed.body.expiresAt) - Date.now()).toBeGreaterThan(59 * 60 * 1000);
		// One call, with the header as written and nothing else of the file.
		expect(mapLayout).toHaveBeenCalledTimes(1);
		const sent = JSON.stringify(mapLayout.mock.calls[0][0]);
		expect(sent).toContain('Verwendungszweck');
		for (const value of DEBIT_CREDIT_CONTENT) expect(sent).not.toContain(value);
		// The proposal keeps the header and masked shapes, not a row.
		const stored = await proposals.findOneByOrFail({id: proposed.body.id});
		expect(stored).toMatchObject({accountId: owner.id, status: 'proposed', failureCode: null, bankId: 'gls-bank'});
		expect(stored.headerCells).toHaveLength(7);
		expect(stored.columnShapes).toEqual([
			'99.99.9999',
			'99.99.9999',
			'Aaaaaaa Aaaa AaaA',
			expect.any(String),
			'99,99',
			'',
			'AAA',
		]);
		const kept = JSON.stringify([stored.headerCells, stored.columnShapes, stored.layout]);
		for (const value of DEBIT_CREDIT_CONTENT) expect(kept).not.toContain(value);

		// A file that names its account may take the bank of a built-in layout whose files name none.
		await fixtures.createConnection(owner, {aspspName: 'Rabobank', aspspCountry: 'NL'});
		expect((await banksFor(agent, proposed.body.id).expect(200)).body).toEqual({banks: ['Rabobank']});
		const saved = await confirm(agent, proposed.body.id, {bankName: ' Example  Bank '}).expect(201);
		expect(saved.body).toEqual({id: expect.any(String), bankName: 'Example Bank', createdAt: expect.any(String)});
		expect(await proposals.findOneByOrFail({id: proposed.body.id})).toMatchObject({status: 'confirmed'});
		expect(await layouts.findOneByOrFail({id: saved.body.id})).toMatchObject({bankId: 'gls-bank'});
		await confirm(agent, proposed.body.id, {bankName: 'Example Bank'}).expect(409);

		const imported = await drop(agent, DEBIT_CREDIT_CSV, picked).expect(201);
		expect(imported.body).toMatchObject({
			bankId: 'gls-bank',
			format: 'csv',
			layout: `learned-${saved.body.id}`,
			rowsParsed: 4,
			rowsAdded: 4,
			accounts: [{name: 'DE89 3704 0044 0532 0130 00', currency: 'EUR', created: true}],
		});
		expect((await agent.get('/bank-imports/layouts').expect(200)).body).toEqual([saved.body]);
		// The account the layout created records the bank the owner named.
		expect(await bankAccounts.findOneByOrFail({id: imported.body.accounts[0].id})).toMatchObject({
			bankIdentity: 'name:example bank',
		});
		// The banks the owner can pick for the next layout are their own, each once: their connections', their
		// imported-files accounts' (kept ones, from earlier imports), spelled as Tempo knows the bank, and their saved
		// layouts'. Not a bank they have no account at, a BIC, or Revolut, whose own files name their accounts.
		await fixtures.createConnection(owner, {aspspName: 'Example  Savings Bank', aspspCountry: 'DE'});
		await fixtures.createConnection(owner, {aspspName: 'ing', aspspCountry: 'NL', status: 'EXPIRED'});
		// Authorizations that never connected hold no bank of the owner's.
		for (const status of ['PENDING_AUTHORIZATION', 'CANCELLED', 'FAILED'])
			await fixtures.createConnection(owner, {aspspName: `Example ${status} Bank`, aspspCountry: 'NL', status});
		// A layout's bank is at most 60 characters, so a longer connection name is not offered.
		await fixtures.createConnection(owner, {aspspName: `Example ${'Long '.repeat(12)}Bank`, aspspCountry: 'NL'});
		const files = await fixtures.connections.findOneByOrFail({accountId: owner.id, provider: 'file'});
		await fixtures.createBankAccounts(files, [
			{bankIdentity: 'name:knab'},
			{bankIdentity: 'name:example credit union'},
			{bankIdentity: 'bic:EXMPDEFF'},
			{bankIdentity: 'name:revolut'},
		]);
		// Offered for the next proposal, of a file that names no account, so not Rabobank either.
		mapLayout.mockResolvedValueOnce(ANSWER.balance);
		const next = await propose(agent, BALANCE_CSV).expect(201);
		expect((await banksFor(agent, next.body.id).expect(200)).body).toEqual({
			banks: ['Example Bank', 'example credit union', 'Example Savings Bank', 'ing', 'Knab'],
		});
		await banksFor(agent, proposed.body.id).expect(409);

		const other = await createOwner();
		expect((await drop(other.agent, DEBIT_CREDIT_CSV).expect(422)).body).toMatchObject({code: 'layout_unknown'});
		await other.agent.get('/bank-imports/layouts').expect(200, []);
		await banksFor(other.agent, next.body.id).expect(404);
		await confirm(other.agent, proposed.body.id, {bankName: 'Example Bank'}).expect(404);
		await other.agent.delete(`/bank-imports/layouts/${saved.body.id}`).set('Origin', ORIGIN).expect(404);
		expect(mapLayout).toHaveBeenCalledTimes(2);
		// Only the drops and proposals that named the verified bank count, and nothing of the file is kept with them.
		expect(await missesOf(owner)).toEqual([
			{bankId: 'gls-bank', outcome: 'refused', refusalCode: 'layout_unknown'},
			{bankId: 'gls-bank', outcome: 'mapper', refusalCode: null},
			{bankId: 'gls-bank', outcome: 'saved_layout', refusalCode: null},
		]);
		expect(await missesOf(other.owner)).toEqual([]);
	});

	it('discards a rejected proposal and refuses to confirm one an hour old', async () => {
		const {owner, agent} = await createOwner();
		mapLayout.mockResolvedValue(ANSWER.balance);

		const rejected = await propose(agent, BALANCE_CSV).expect(201);
		await agent.post(`/bank-imports/layout-proposals/${rejected.body.id}/reject`).set('Origin', ORIGIN).expect(204);

		expect(await proposals.findOneByOrFail({id: rejected.body.id})).toMatchObject({status: 'rejected'});
		await confirm(agent, rejected.body.id, {bankName: 'Example Bank', currency: 'GBP'}).expect(409);
		expect((await drop(agent, BALANCE_CSV).expect(422)).body).toMatchObject({code: 'layout_unknown'});

		const expired = await propose(agent, BALANCE_CSV).expect(201);
		await proposals.update({id: expired.body.id}, {expiresAt: new Date(Date.now() - 1000)});
		const refused = await confirm(agent, expired.body.id, {bankName: 'Example Bank', currency: 'GBP'}).expect(410);

		expect(refused.body).toMatchObject({code: 'layout_proposal_expired'});
		expect(await layouts.countBy({accountId: owner.id})).toBe(0);
	});

	it('works out the columns of at most 5 files per owner in 24 hours, whatever their outcome', async () => {
		const {owner, agent} = await createOwner();
		const day = 24 * 60 * 60 * 1000;
		const oldest = new Date(Date.now() - day + 60 * 60 * 1000);
		for (const [index, createdAt] of [oldest, ...Array.from({length: 4}, () => new Date())].entries()) {
			const saved = await proposals.save(
				proposals.create({
					accountId: owner.id,
					fileHash: String(index).repeat(64),
					status: 'failed',
					failureCode: 'layout_not_mappable',
					headerCells: null,
					columnShapes: null,
					layout: null,
					expiresAt: new Date(),
				}),
			);
			await proposals.update({id: saved.id}, {createdAt});
		}
		// One from more than a day ago no longer counts.
		const old = await proposals.save(
			proposals.create({accountId: owner.id, fileHash: 'f'.repeat(64), status: 'failed', expiresAt: new Date()}),
		);
		await proposals.update({id: old.id}, {createdAt: new Date(Date.now() - 2 * day)});

		const refused = await propose(agent, BALANCE_CSV).expect(422);

		expect(refused.body).toMatchObject({
			code: 'mapper_limit_reached',
			file: 1,
			retryAt: new Date(oldest.getTime() + day).toISOString(),
		});
		expect(mapLayout).not.toHaveBeenCalled();
		const other = await createOwner();
		mapLayout.mockResolvedValueOnce(ANSWER.balance);
		await propose(other.agent, BALANCE_CSV).expect(201);
	});

	it.each([
		{
			name: 'a malformed answer',
			answer: () => mapLayout.mockRejectedValueOnce(new LayoutMapperError('invalid')),
			status: 422,
			code: 'layout_not_mappable',
		},
		{
			name: 'a layout that does not read every row',
			answer: () => mapLayout.mockResolvedValueOnce({...ANSWER.balance, dateFormat: 'YYYY/MM/DD'}),
			status: 422,
			code: 'layout_not_mappable',
		},
		{
			name: 'an answer that is no layout',
			answer: () => mapLayout.mockResolvedValueOnce({...ANSWER.balance, bookingDate: 9}),
			status: 422,
			code: 'layout_not_mappable',
		},
		{
			name: 'a model that failed, timed out or had no credit',
			answer: () => mapLayout.mockRejectedValueOnce(new LayoutMapperError('unavailable')),
			status: 503,
			code: 'mapper_unavailable',
		},
	])('refuses $name after one call and offers nothing', async ({answer, status, code}) => {
		const {owner, agent} = await createOwner();
		answer();

		const refused = await propose(agent, BALANCE_CSV, {bankId: 'ing-nl'}).expect(status);

		expect(refused.body).toMatchObject({code, file: 1});
		expect(mapLayout).toHaveBeenCalledTimes(1);
		expect(await proposals.findBy({accountId: owner.id})).toEqual([
			expect.objectContaining({status: 'failed', failureCode: code, layout: null}),
		]);
		expect(await missesOf(owner)).toEqual([{bankId: 'ing-nl', outcome: 'mapper', refusalCode: code}]);
	});

	it.each([
		{
			// The rows whose note holds a comma are wider than the rest, so the widest stretch of equal lines starts
			// below them.
			name: 'lines above the table look',
			lines: [
				'Date,Amount,Account,Note',
				'2026-03-02,-12.50,NL91ABNA0417164300,Example Shop, Examplestad',
				'2026-03-03,-4.20,NL91ABNA0417164300,Example Cafe, Examplestad, Centre',
				'2026-03-04,-1.00,NL91ABNA0417164300,Example Shop',
				'2026-03-05,-2.00,NL91ABNA0417164300,Example Shop',
				'2026-03-06,-3.00,NL91ABNA0417164300,Example Shop',
			],
		},
		{
			// A layout learned from it would skip the last row of every whole file.
			name: 'last line, cut short, looks',
			lines: readFileSync(join(FIXTURES, 'starling-cut-last-line-synthetic.csv'), 'utf8').trimEnd().split('\n'),
		},
	])('refuses to work out the columns of a file whose $name like rows, without a call', async ({lines}) => {
		const {owner, agent} = await createOwner();
		const file = Buffer.from([...lines, ''].join('\n'));
		expect((await drop(agent, file).expect(422)).body).toMatchObject({code: 'layout_unknown', file: 1});

		const refused = await propose(agent, file).expect(422);

		expect(refused.body).toMatchObject({code: 'layout_not_mappable', file: 1});
		expect(mapLayout).not.toHaveBeenCalled();
		expect(await proposals.countBy({accountId: owner.id})).toBe(0);
	});

	it.each([
		{
			name: 'a header wider than a layout holds',
			// The table is wider than any layout, so it is refused as no table before its header is checked.
			code: 'unsupported_format',
			status: 415,
			file: () =>
				Buffer.from(
					[
						['Date', 'Amount', ...Array.from({length: 199}, () => 'Note')].join(','),
						['2026-03-02', '-12.50', ...Array.from({length: 199}, () => 'Example')].join(','),
						['2026-03-03', '-4.20', ...Array.from({length: 199}, () => 'Example')].join(','),
						'',
					].join('\n'),
				),
		},
		{
			name: 'a header cell longer than a layout holds',
			code: 'layout_not_mappable',
			status: 422,
			file: () =>
				Buffer.from(
					[
						`Date,Amount,Note ${'n'.repeat(200)}`,
						'2026-03-02,-12.50,Example Shop',
						'2026-03-03,-4.20,Example Cafe',
						'',
					].join('\n'),
				),
		},
		{
			name: 'a header larger than a saved layout holds',
			code: 'layout_not_mappable',
			status: 422,
			// Each heading fits a layout and is cut short in the sample, but together they pass a saved layout's size.
			file: () =>
				Buffer.from(
					[
						['Date', 'Amount', ...Array.from({length: 118}, () => 'N'.repeat(150))].join(','),
						['2026-03-02', '-12.50', ...Array.from({length: 118}, () => 'x')].join(','),
						['2026-03-03', '-4.20', ...Array.from({length: 118}, () => 'x')].join(','),
						'',
					].join('\n'),
				),
		},
		{
			name: 'a sample larger than any bank export sends',
			code: 'layout_not_mappable',
			status: 422,
			// 150 columns of long notes, each holding six values or more over the table.
			file: () =>
				Buffer.from(
					[
						['Date', 'Amount', ...Array.from({length: 148}, () => 'Note')].join(','),
						...Array.from({length: 8}, (_, row) =>
							[
								`2026-03-0${row + 1}`,
								`-${row + 1}.50`,
								...Array.from(
									{length: 148},
									(__, column) => `Example ${'x'.repeat(50)} ${row}-${column}`,
								),
							].join(','),
						),
						'',
					].join('\n'),
				),
		},
	])(
		'refuses to work out the columns of a file with $name, without a call or a used proposal',
		async ({file, code, status}) => {
			const {owner, agent} = await createOwner();

			const refused = await propose(agent, file()).expect(status);

			expect(refused.body).toMatchObject({code, file: 1});
			expect(mapLayout).not.toHaveBeenCalled();
			expect(await proposals.countBy({accountId: owner.id})).toBe(0);
		},
	);

	it("asks where a saved layout's file goes when the account its IBAN names holds none of its rows, and imports it where the owner chooses", async () => {
		const {owner, agent} = await createOwner();
		const iban = 'NL86BUNQ2000000001';
		const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07'];
		const current = Buffer.from(
			[
				'"Date","Amount","Account","Counterparty","Name","Description"',
				...days.map((day, index) => `"${day}","-${index + 1}0,00","${iban}","","Example Shop","Example"`),
				'',
			].join('\n'),
		);
		// A card export whose first column is the current account the card is paid from.
		const card = (amounts: string[]) =>
			Buffer.from(
				[
					'Linked account,Currency,Card,Date,Amount,Description',
					...days.map((day, index) => `${iban},EUR,9999,${day},${amounts[index]},Example Card Shop`),
					'',
				].join('\n'),
			);
		const cardRows = card(['-4.10', '-7.20', '-3.30', '-9.40', '-2.50', '-8.60']);
		const currentRows = card(['-10.00', '-20.00', '-30.00', '-40.00', '-50.00', '-60.00']);
		const imported = await drop(agent, current).expect(201);
		const currentAccount = imported.body.accounts[0];
		await saveLayout(
			agent,
			cardRows,
			{
				...ANSWER.headerless,
				bookingDate: 3,
				amount: {kind: 'signed', column: 4},
				currency: {column: 1},
				description: [5],
				account: {column: 0},
			},
			{bankName: 'Example Card Bank'},
		);

		// Rows the account already holds confirm it.
		expect((await drop(agent, currentRows).expect(201)).body).toMatchObject({
			rowsAdded: 0,
			rowsAlreadyPresent: 6,
			accounts: [{id: currentAccount.id, created: false}],
		});

		const refused = await drop(agent, cardRows).expect(409);

		expect(refused.body).toMatchObject({
			code: 'target_account_unconfirmed',
			accountQuestions: [
				{
					bank: 'Example Card Bank',
					currency: 'EUR',
					candidates: [{bankAccountId: currentAccount.id, imported: true}],
					newAccount: true,
				},
			],
		});
		expect(await transactions.countBy({bankAccountId: currentAccount.id})).toBe(6);

		const chosen = await drop(agent, cardRows)
			.field('accountChoices', JSON.stringify({'Example Card Bank:EUR': 'new'}))
			.expect(201);

		expect(chosen.body).toMatchObject({rowsAdded: 6, accounts: [{name: 'Example Card Bank EUR', created: true}]});
		expect(await bankAccounts.findOneByOrFail({id: chosen.body.accounts[0].id})).toMatchObject({
			providerAccountId: 'file-bank:Example Card Bank:EUR',
			iban: null,
		});
		expect(await transactions.countBy({bankAccountId: currentAccount.id})).toBe(6);
		// The answer holds for the layout's later files.
		expect((await drop(agent, cardRows).expect(201)).body).toMatchObject({
			rowsAdded: 0,
			rowsAlreadyPresent: 6,
			accounts: [{id: chosen.body.accounts[0].id}],
		});
		expect(await bankAccounts.countBy({bankConnection: {accountId: owner.id}})).toBe(2);
	});

	it("checks a saved layout's rows against a synced account too, and asks only about statements of a bank and currency of their own", async () => {
		const {owner, agent} = await createOwner();
		const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'];
		const [first, second] = ['NL86BUNQ2000000001', 'NL05BUNQ2000000101'];
		const connection = await fixtures.createConnection(owner);
		const synced = await fixtures.createBankAccount(connection, {iban: first});
		await fixtures.createTransactions(
			synced,
			days.map((bookingDate, index) => ({bookingDate, valueDate: bookingDate, amount: `-${index + 1}0.00`})),
		);
		const card = (ibans: string[]) =>
			Buffer.from(
				[
					'Linked account,Currency,Card,Date,Amount,Description',
					...ibans.flatMap((iban) =>
						days.map((day, index) => `${iban},EUR,9999,${day},-${index + 3}.40,Example Card Shop`),
					),
					'',
				].join('\n'),
			);
		await saveLayout(
			agent,
			card([first]),
			{
				...ANSWER.headerless,
				bookingDate: 3,
				amount: {kind: 'signed', column: 4},
				currency: {column: 1},
				description: [5],
				account: {column: 0},
			},
			{bankName: 'Example Card Bank'},
		);
		const bunq = Buffer.from(
			[
				'"Date","Amount","Account","Counterparty","Name","Description"',
				`"2026-03-09","-1,00","${first}","","Example Shop","Example"`,
				'',
			].join('\n'),
		);
		// The synced account holds none of the card rows.
		expect((await drop(agent, card([first])).expect(409)).body).toMatchObject({
			code: 'target_account_unconfirmed',
			accountQuestions: [{bank: 'Example Card Bank', candidates: [{bankAccountId: synced.id, imported: false}]}],
		});
		// Beside a built-in export of the same account, or another statement under the same bank and currency, an
		// answer would move rows it is not about: the drop is refused without a question.
		await fixtures.createTransactions(
			await fixtures.createBankAccount(connection, {iban: second}),
			days.map((bookingDate) => ({bookingDate, valueDate: bookingDate, amount: '-99.00'})),
		);
		for (const files of [[card([first]), bunq], [card([first, second])]]) {
			const refused = drop(agent, files[0]);
			if (files[1]) refused.attach('files', files[1], 'upload-1.bin');
			expect((await refused.expect(409)).body).toEqual(
				expect.objectContaining({code: 'target_account_unconfirmed', accountQuestions: []}),
			);
		}
		expect(await transactions.countBy({bankAccountId: synced.id})).toBe(5);
	});

	it("refuses a bank name of Tempo's own files that name no account, so a layout never shares their accounts", async () => {
		const {owner, agent} = await createOwner();
		mapLayout.mockResolvedValueOnce(ANSWER.balance);
		const proposed = await propose(agent, BALANCE_CSV).expect(201);

		for (const [bankName, bank] of [
			[' revolut ', 'Revolut'],
			['REVOLUT', 'Revolut'],
			// Its credit card export names no account.
			['rabobank', 'Rabobank'],
		]) {
			const refused = await confirm(agent, proposed.body.id, {bankName, currency: 'GBP'}).expect(400);
			expect(refused.body.message).toBe(
				`${bank}'s own exports already import into your ${bank} accounts. Name this bank differently.`,
			);
		}
		expect(await layouts.countBy({accountId: owner.id})).toBe(0);
		await confirm(agent, proposed.body.id, {bankName: 'Revolut Example', currency: 'GBP'}).expect(201);
		// A layout whose files name their account shares no account with those files.
		mapLayout.mockResolvedValueOnce(ANSWER.debitCredit);
		const named = await propose(agent, DEBIT_CREDIT_CSV).expect(201);
		await confirm(agent, named.body.id, {bankName: 'Rabobank'}).expect(201);
	});

	it('refuses to save a layout too large to send to the file reader with the others', async () => {
		const {owner, agent} = await createOwner();
		// 84 headings of 190 characters: a header a saved layout holds, in a layout just over 16 KiB.
		const headings = Array.from({length: 84}, (_, index) => `Heading ${index} `.padEnd(190, 'x'));
		const filler = Array.from({length: 82}, () => 'x');
		const wide = Buffer.from(
			[
				headings.join(';'),
				['02.03.2026', '-12,50', ...filler].join(';'),
				['03.03.2026', '-4,20', ...filler].join(';'),
				'',
			].join('\n'),
		);
		mapLayout.mockResolvedValueOnce({
			...ANSWER.balance,
			dateFormat: 'DD.MM.YYYY',
			amount: {kind: 'signed', column: 1},
			decimalMark: ',',
			thousandsSeparator: null,
			currency: {code: 'EUR'},
			balance: null,
			description: [],
		});
		const proposed = await propose(agent, wide).expect(201);

		const refused = await confirm(agent, proposed.body.id, {bankName: 'Example Bank', currency: 'EUR'}).expect(422);

		expect(refused.body).toMatchObject({code: 'layout_not_mappable'});
		expect(await layouts.countBy({accountId: owner.id})).toBe(0);
	});

	it('removes a saved layout without touching what it imported', async () => {
		const {agent} = await createOwner();
		const saved = await saveLayout(agent, HEADERLESS_CSV, ANSWER.headerless, {bankName: 'Example Bank'});
		const imported = await drop(agent, HEADERLESS_CSV)
			.field('accountChoices', JSON.stringify({'Example Bank:EUR': 'new'}))
			.expect(201);

		await agent.delete(`/bank-imports/layouts/${saved.id}`).set('Origin', ORIGIN).expect(204);

		await agent.get('/bank-imports/layouts').expect(200, []);
		expect(await transactions.countBy({importId: imported.body.id})).toBe(4);
		expect((await drop(agent, HEADERLESS_CSV).expect(422)).body).toMatchObject({code: 'layout_unknown'});
	});

	it('reads a workbook with the layout its owner confirmed', async () => {
		const {agent} = await createOwner();
		// The workbook shows no currency, so its owner picks the one the model named.
		await saveLayout(agent, WORKBOOK, ANSWER.workbook, {bankName: 'Example Workbook Bank', currency: 'EUR'});

		expect((await drop(agent, WORKBOOK).expect(201)).body).toMatchObject({
			format: 'csv',
			rowsAdded: 2,
			dateFrom: '2026-03-02',
			dateTo: '2026-03-03',
			accounts: [{name: 'Example Workbook Bank EUR', created: true}],
		});
	});

	it('reads a file without a header that names its account with the layout its owner confirmed, unasked', async () => {
		const {agent} = await createOwner();
		const withAccount = Buffer.from(
			[
				'2026-03-02;-12.50;EUR;NL91ABNA0417164300;Example Shop',
				'2026-03-03;-4.20;EUR;NL91ABNA0417164300;Example Cafe',
				'',
			].join('\n'),
		);
		await saveLayout(
			agent,
			withAccount,
			{...ANSWER.headerless, account: {column: 3}, description: [4]},
			{bankName: 'Example Account Bank'},
		);

		expect((await drop(agent, withAccount).expect(201)).body).toMatchObject({
			rowsAdded: 2,
			accounts: [{name: 'NL91 ABNA 0417 1643 00', created: true}],
		});
	});

	/** The question a drop of `HEADERLESS_CSV` gets under a saved Example Bank layout: its rows as that layout read them. */
	const HEADERLESS_QUESTION = {
		bank: 'Example Bank',
		currency: 'EUR',
		layoutPreview: {
			rowCount: 4,
			dateFrom: '2026-03-02',
			dateTo: '2026-03-05',
			firstRows: [
				expect.objectContaining({
					date: '2026-03-02',
					amount: '-12.50',
					currency: 'EUR',
					description: 'Example Shop',
				}),
				expect.objectContaining({date: '2026-03-03', amount: '-850.00'}),
			],
			lastRows: [],
			totals: [{currency: 'EUR', moneyIn: '2500.00', moneyOut: '902.49'}],
			accounts: [],
		},
	};

	it('asks which account a file without a header or account goes to, with its rows as read and every account in its currency, and imports it where the owner chooses', async () => {
		const {owner, agent} = await createOwner();
		await saveLayout(agent, HEADERLESS_CSV, ANSWER.headerless, {bankName: 'Example Bank'});
		const exampleBank = await fixtures.createConnection(owner, {aspspName: 'Example Bank'});
		// Closed, yet still the bank's accounts this file could be.
		const atExampleBank = [
			await fixtures.createBankAccount(exampleBank, {isActive: false}),
			await fixtures.createBankAccount(exampleBank, {isActive: false}),
		];
		const atAnotherBank = await fixtures.createBankAccount(
			await fixtures.createConnection(owner, {aspspName: 'Another Bank'}),
		);
		const files = await fixtures.createConnection(owner, {
			provider: 'file',
			aspspName: 'Imported files',
			aspspCountry: 'ZZ',
		});
		const bankless = await fixtures.createBankAccount(files, {
			providerAccountId: 'file:EXAMPLE-ID:EUR',
			identificationHash: 'file:example-id',
			bankIdentity: null,
		});

		const april = Buffer.from(
			[
				'2026-03-05;-39.99;EUR;Example Shop',
				'2026-04-01;-7.00;EUR;Example Bakery',
				'2026-04-02;-8.00;EUR;Example Bakery',
				'2026-04-03;-9.00;EUR;Example Bakery',
				'',
			].join('\n'),
		);
		// Two exports in one archive, each its own statement.
		const both = () =>
			drop(
				agent,
				createZip([
					{name: 'march.csv', content: HEADERLESS_CSV},
					{name: 'april.csv', content: april},
				]),
			);

		// Another bank's export of the same columns would read too, so nothing is written until the owner says where,
		// and the question shows the first two rows of each file as read, counting the row both files hold in each.
		const asked = await both().expect(409);
		expect(asked.body).toMatchObject({
			code: 'target_account_unconfirmed',
			accountQuestions: [
				{
					...HEADERLESS_QUESTION,
					layoutPreview: {
						...HEADERLESS_QUESTION.layoutPreview,
						rowCount: 8,
						dateTo: '2026-04-03',
						firstRows: [
							...HEADERLESS_QUESTION.layoutPreview.firstRows,
							expect.objectContaining({date: '2026-03-05', amount: '-39.99'}),
							expect.objectContaining({
								date: '2026-04-01',
								amount: '-7.00',
								description: 'Example Bakery',
							}),
						],
						totals: [{currency: 'EUR', moneyIn: '2500.00', moneyOut: '966.48'}],
					},
					newAccount: true,
				},
			],
		});
		expect(
			(asked.body.accountQuestions[0].candidates as {bankAccountId: string}[])
				.map(({bankAccountId}) => bankAccountId)
				.sort(),
		).toEqual([...atExampleBank, atAnotherBank, bankless].map(({id}) => id).sort());
		expect(await transactions.count({where: {bankAccount: {bankConnection: {account: {id: owner.id}}}}})).toBe(0);

		await both()
			.field('accountChoices', JSON.stringify({'Example Bank:EUR': bankless.id}))
			.expect(201);

		expect(await transactions.countBy({bankAccountId: bankless.id})).toBe(7);
		// Nothing in the file names its bank, so the account it went to does not take the layout's.
		expect(await bankAccounts.findOneByOrFail({id: bankless.id})).toMatchObject({bankIdentity: null});
	});

	it("records the layout's bank on the chosen account when a file with a header of that bank comes in the same drop", async () => {
		const {owner, agent} = await createOwner();
		await saveLayout(agent, HEADERLESS_CSV, ANSWER.headerless, {bankName: 'Example Bank'});
		mapLayout.mockResolvedValueOnce(ANSWER.balance);
		const proposed = await propose(agent, BALANCE_CSV).expect(201);
		await confirm(agent, proposed.body.id, {bankName: 'Example Bank', currency: 'EUR'}).expect(201);
		const files = await fixtures.createConnection(owner, {
			provider: 'file',
			aspspName: 'Imported files',
			aspspCountry: 'ZZ',
		});
		const bankless = await fixtures.createBankAccount(files, {
			providerAccountId: 'file:EXAMPLE-ID:EUR',
			identificationHash: 'file:example-id',
			bankIdentity: null,
		});

		await drop(agent, HEADERLESS_CSV)
			.attach('files', BALANCE_CSV, 'upload-1.bin')
			.field('accountChoices', JSON.stringify({'Example Bank:EUR': bankless.id}))
			.expect(201);

		expect(await transactions.countBy({bankAccountId: bankless.id})).toBe(8);
		expect(await bankAccounts.findOneByOrFail({id: bankless.id})).toMatchObject({
			bankIdentity: 'name:example bank',
		});
	});

	it("asks on every drop of a file without a header or account, a new account for it recording the layout's bank", async () => {
		const {agent} = await createOwner();
		await saveLayout(agent, HEADERLESS_CSV, ANSWER.headerless, {bankName: 'Example Bank'});
		await drop(agent, HEADERLESS_CSV).expect(409);

		const imported = await drop(agent, HEADERLESS_CSV)
			.field('accountChoices', JSON.stringify({'Example Bank:EUR': 'new'}))
			.expect(201);

		expect(imported.body).toMatchObject({rowsAdded: 4, accounts: [{name: 'Example Bank EUR', created: true}]});
		const [account] = imported.body.accounts as {id: string}[];
		expect(await bankAccounts.findOneByOrFail({id: account.id})).toMatchObject({
			bankIdentity: 'name:example bank',
		});
		expect((await drop(agent, HEADERLESS_CSV).expect(409)).body).toMatchObject({
			code: 'target_account_unconfirmed',
			accountQuestions: [{...HEADERLESS_QUESTION, candidates: [{bankAccountId: account.id}], newAccount: false}],
		});
	});

	it('routes a file that names no account by the bank its owner named and the currency they chose, also one the ECB no longer publishes, as Revolut files go', async () => {
		const {owner, agent} = await createOwner();
		mapLayout.mockResolvedValueOnce(ANSWER.balance);
		const proposed = await propose(agent, BALANCE_CSV).expect(201);

		// Every date reads day first and month first, so the owner is asked to check one.
		expect(proposed.body).toMatchObject({
			bankName: null,
			currencyNeeded: true,
			defaultCurrency: 'EUR',
			dateCheck: {written: '02/03/2026', date: '2026-03-02'},
			preview: {accounts: [], totals: [{currency: 'EUR', moneyIn: '1800.00', moneyOut: '677.60'}]},
		});
		await confirm(agent, proposed.body.id, {bankName: 'Example Bank'}).expect(400);
		await confirm(agent, proposed.body.id, {bankName: '', currency: 'HRK'}).expect(400);
		// 61 characters as written, though single spacing would make them 60.
		await confirm(agent, proposed.body.id, {bankName: `Example  ${'B'.repeat(52)}`, currency: 'HRK'}).expect(400);
		await confirm(agent, proposed.body.id, {bankName: 'Example Bank', currency: 'HRK'}).expect(201);

		const connection = await fixtures.createConnection(owner, {aspspName: 'Example Bank'});
		const first = await fixtures.createBankAccount(connection, {currency: 'HRK'});
		const second = await fixtures.createBankAccount(connection, {currency: 'HRK'});
		const refused = await drop(agent, BALANCE_CSV).expect(409);
		expect(refused.body).toMatchObject({
			code: 'ambiguous_target_account',
			accountQuestions: [
				{
					bank: 'Example Bank',
					currency: 'HRK',
					candidates: [{bankAccountId: first.id}, {bankAccountId: second.id}].sort((left, right) =>
						left.bankAccountId.localeCompare(right.bankAccountId),
					),
				},
			],
		});

		const imported = await drop(agent, BALANCE_CSV)
			.field('accountChoices', JSON.stringify({'Example Bank:HRK': 'new'}))
			.expect(201);
		expect(imported.body).toMatchObject({rowsAdded: 4, accounts: [{name: 'Example Bank HRK', created: true}]});
		expect(await bankAccounts.findOneByOrFail({id: imported.body.accounts[0].id})).toMatchObject({
			providerAccountId: 'file-bank:Example Bank:HRK',
			iban: null,
			currency: 'HRK',
		});
	});

	it("imports a file that names no account into its bank's account however an earlier layout spelled the bank", async () => {
		const {owner, agent} = await createOwner();
		mapLayout.mockResolvedValueOnce(ANSWER.balance);
		const proposed = await propose(agent, BALANCE_CSV).expect(201);
		await confirm(agent, proposed.body.id, {bankName: 'Example Bank', currency: 'EUR'}).expect(201);
		const files = await fixtures.createConnection(owner, {
			provider: 'file',
			aspspName: 'Imported files',
			aspspCountry: 'ZZ',
		});
		const earlier = await fixtures.createBankAccount(files, {
			providerAccountId: 'file-bank:example  BANK:EUR',
			currency: 'EUR',
		});

		const imported = await drop(agent, BALANCE_CSV).expect(201);

		expect(imported.body).toMatchObject({rowsAdded: 4, accounts: [{id: earlier.id, created: false}]});
		expect(await bankAccounts.countBy({bankConnection: {id: files.id}})).toBe(1);
	});
});
