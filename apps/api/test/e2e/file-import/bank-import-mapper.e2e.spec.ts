import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import type {BankImportLayoutProposal as ProposalResponse} from '@tempo/contracts';
import {readFileSync} from 'node:fs';
import {Server} from 'node:net';
import {join} from 'node:path';
import TestAgent from 'supertest/lib/agent';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {BankImportLayoutProposal} from '@modules/file-import/bank-import-layout-proposal.entity';
import {BankImportLayout} from '@modules/file-import/bank-import-layout.entity';
import {LayoutMapper, LayoutMapperError} from '@modules/file-import/mapper/layout-mapper';
import {LayoutAnswer} from '@modules/file-import/mapper/layout-mapper.contract';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {createWorkbook} from '../../fixtures/statement-file.fixture';
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
	let bankAccounts: Repository<BankAccount>;
	let transactions: Repository<BankTransaction>;

	beforeAll(() => {
		app = getApp();
		httpServer = app.getHttpServer() as Server;
		fixtures = new BankingFixtures(app);
		accounts = app.get(getRepositoryToken(Account));
		proposals = app.get(getRepositoryToken(BankImportLayoutProposal));
		layouts = app.get(getRepositoryToken(BankImportLayout));
		bankAccounts = fixtures.bankAccounts;
		transactions = fixtures.transactions;
	});

	beforeEach(() => mapLayout.mockReset());

	async function createOwner(): Promise<{owner: Account; agent: TestAgent}> {
		const fresh = await createVerifiedAccount(httpServer, MAILPIT_API_URL);
		await accounts.update({id: fresh.id}, {baseCurrency: 'EUR'});
		return {owner: await accounts.findOneByOrFail({id: fresh.id}), agent: fresh.agent};
	}

	function drop(agent: TestAgent, file: Buffer) {
		return agent.post('/bank-imports').set('Origin', ORIGIN).attach('files', file, 'upload-0.bin');
	}

	function propose(agent: TestAgent, file: Buffer) {
		return agent.post('/bank-imports/layout-proposals').set('Origin', ORIGIN).attach('files', file, 'upload-0.bin');
	}

	function confirm(agent: TestAgent, proposalId: string, body: Record<string, unknown>) {
		return agent.post(`/bank-imports/layout-proposals/${proposalId}/confirm`).set('Origin', ORIGIN).send(body);
	}

	/** Proposes and confirms a layout for the file, the model answering `answer`. */
	async function saveLayout(agent: TestAgent, file: Buffer, answer: LayoutAnswer, body: Record<string, unknown>) {
		mapLayout.mockResolvedValueOnce(answer);
		const proposal = await propose(agent, file).expect(201);
		return (await confirm(agent, (proposal.body as ProposalResponse).id, body).expect(201)).body as {id: string};
	}

	it("works out a file's columns with one call on a masked sample, saves the confirmed layout for its owner only and imports the same drop with it", async () => {
		const {owner, agent} = await createOwner();
		expect((await agent.get('/bank-imports').expect(200)).body).toEqual({imports: [], mapper: true});
		expect((await drop(agent, DEBIT_CREDIT_CSV).expect(422)).body).toMatchObject({code: 'layout_unknown', file: 1});

		mapLayout.mockResolvedValueOnce(ANSWER.debitCredit);
		const proposed = await propose(agent, DEBIT_CREDIT_CSV).expect(201);

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
		expect(stored).toMatchObject({accountId: owner.id, status: 'proposed', failureCode: null});
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

		const saved = await confirm(agent, proposed.body.id, {bankName: ' Example Bank '}).expect(201);
		expect(saved.body).toEqual({id: expect.any(String), bankName: 'Example Bank', createdAt: expect.any(String)});
		expect(await proposals.findOneByOrFail({id: proposed.body.id})).toMatchObject({status: 'confirmed'});
		await confirm(agent, proposed.body.id, {bankName: 'Example Bank'}).expect(409);

		const imported = await drop(agent, DEBIT_CREDIT_CSV).expect(201);
		expect(imported.body).toMatchObject({
			format: 'csv',
			layout: `learned-${saved.body.id}`,
			rowsParsed: 4,
			rowsAdded: 4,
			accounts: [{name: 'DE89 3704 0044 0532 0130 00', currency: 'EUR', created: true}],
		});
		expect((await agent.get('/bank-imports/layouts').expect(200)).body).toEqual([saved.body]);

		const other = await createOwner();
		expect((await drop(other.agent, DEBIT_CREDIT_CSV).expect(422)).body).toMatchObject({code: 'layout_unknown'});
		await other.agent.get('/bank-imports/layouts').expect(200, []);
		await confirm(other.agent, proposed.body.id, {bankName: 'Example Bank'}).expect(404);
		await other.agent.delete(`/bank-imports/layouts/${saved.body.id}`).set('Origin', ORIGIN).expect(404);
		expect(mapLayout).toHaveBeenCalledTimes(1);
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

		const refused = await propose(agent, BALANCE_CSV).expect(status);

		expect(refused.body).toMatchObject({code, file: 1});
		expect(mapLayout).toHaveBeenCalledTimes(1);
		expect(await proposals.findBy({accountId: owner.id})).toEqual([
			expect.objectContaining({status: 'failed', failureCode: code, layout: null}),
		]);
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
			lines: [
				'Date,Amount,Account,Note',
				'2026-03-02,-12.50,NL91ABNA0417164300,Example Shop',
				'2026-03-03,-4.20,NL91ABNA0417164300,Example Cafe',
				'2026-03-04,-1.00,NL91ABNA0417164300,Example Shop',
				'2026-03-05,-2.00,NL91ABNA0417164300',
			],
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
		// 100 headings of 190 characters: a layout of about 20 KiB.
		const headings = Array.from({length: 100}, (_, index) => `Heading ${index} `.padEnd(190, 'x'));
		const filler = Array.from({length: 98}, () => 'x');
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

		const refused = await confirm(agent, proposed.body.id, {bankName: 'Example Bank'}).expect(422);

		expect(refused.body).toMatchObject({code: 'layout_not_mappable'});
		expect(await layouts.countBy({accountId: owner.id})).toBe(0);
	});

	it('removes a saved layout without touching what it imported', async () => {
		const {agent} = await createOwner();
		const saved = await saveLayout(agent, HEADERLESS_CSV, ANSWER.headerless, {bankName: 'Example Bank'});
		const imported = await drop(agent, HEADERLESS_CSV).expect(201);

		await agent.delete(`/bank-imports/layouts/${saved.id}`).set('Origin', ORIGIN).expect(204);

		await agent.get('/bank-imports/layouts').expect(200, []);
		expect(await transactions.countBy({importId: imported.body.id})).toBe(4);
		expect((await drop(agent, HEADERLESS_CSV).expect(422)).body).toMatchObject({code: 'layout_unknown'});
	});

	it('reads a file without a header and a workbook with the layouts their owner confirmed', async () => {
		const {agent} = await createOwner();
		await saveLayout(agent, HEADERLESS_CSV, ANSWER.headerless, {bankName: 'Example Bank'});
		await saveLayout(agent, WORKBOOK, ANSWER.workbook, {bankName: 'Example Workbook Bank'});

		expect((await drop(agent, HEADERLESS_CSV).expect(201)).body).toMatchObject({
			rowsAdded: 4,
			accounts: [{name: 'Example Bank EUR', created: true}],
		});
		expect((await drop(agent, WORKBOOK).expect(201)).body).toMatchObject({
			format: 'csv',
			rowsAdded: 2,
			dateFrom: '2026-03-02',
			dateTo: '2026-03-03',
			accounts: [{name: 'Example Workbook Bank EUR', created: true}],
		});
	});

	it('routes a file that names no account by the bank its owner named and the currency they chose, as Revolut files go', async () => {
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
		await confirm(agent, proposed.body.id, {bankName: '', currency: 'GBP'}).expect(400);
		await confirm(agent, proposed.body.id, {bankName: 'Example Bank', currency: 'GBP'}).expect(201);

		const connection = await fixtures.createConnection(owner, {aspspName: 'Example Bank'});
		const first = await fixtures.createBankAccount(connection, {currency: 'GBP'});
		const second = await fixtures.createBankAccount(connection, {currency: 'GBP'});
		const refused = await drop(agent, BALANCE_CSV).expect(409);
		expect(refused.body).toMatchObject({
			code: 'ambiguous_target_account',
			accountQuestions: [
				{
					bank: 'Example Bank',
					currency: 'GBP',
					candidates: [{bankAccountId: first.id}, {bankAccountId: second.id}].sort((left, right) =>
						left.bankAccountId.localeCompare(right.bankAccountId),
					),
				},
			],
		});

		const imported = await drop(agent, BALANCE_CSV)
			.field('accountChoices', JSON.stringify({'Example Bank:GBP': 'new'}))
			.expect(201);
		expect(imported.body).toMatchObject({rowsAdded: 4, accounts: [{name: 'Example Bank GBP', created: true}]});
		expect(await bankAccounts.findOneByOrFail({id: imported.body.accounts[0].id})).toMatchObject({
			providerAccountId: 'file-bank:Example Bank:GBP',
			iban: null,
			currency: 'GBP',
		});
	});
});
