import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import type {BankImportSummary, DataCoverage, SpendingPace} from '@tempo/contracts';
import TestAgent from 'supertest/lib/agent';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BankImport} from '@modules/file-import/bank-import.entity';

import {BankingFixtures, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {type CamtEntry, EXAMPLE_IBAN, OTHER_EXAMPLE_IBAN, camt053} from '../../fixtures/statement-file.fixture';
import {enableFileImportE2e, getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

enableFileImportE2e();

const PACE = '/bank-transactions/spending-pace';
const COVERAGE = '/bank-connections/coverage';
const AS_OF = '2026-10-18';
const USUAL_MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

describe('Spending pace and data coverage', () => {
	let app: INestApplication;
	let fixtures: BankingFixtures;
	let accounts: Repository<Account>;
	let imports: Repository<BankImport>;

	beforeAll(() => {
		app = getApp();
		fixtures = new BankingFixtures(app);
		accounts = app.get(getRepositoryToken(Account));
		imports = app.get(getRepositoryToken(BankImport));
	});

	/**
	 * A synced owner in Amsterdam whose account's transactions were last fetched completely through `fetchedThrough`.
	 * A later run succeeded without fetching them, as a balance-only retry does.
	 */
	async function syncedOwner(fetchedThrough: string | null) {
		const synced = await createBankingOwner(app, {baseCurrency: 'EUR'});
		await accounts.update({id: synced.owner.id}, {timeZone: 'Europe/Amsterdam'});
		await fixtures.bankAccounts.update({id: synced.bankAccount.id}, {transactionsFetchedThrough: fetchedThrough});
		await fixtures.createSyncRun(synced.connection, {
			status: 'SUCCEEDED',
			finishedAt: new Date('2026-10-17T08:00:00.000Z'),
		});
		return synced;
	}

	it('adds up this month through the last covered day against the newest six complete months', async () => {
		const {agent, bankAccount} = await syncedOwner('2026-10-15');
		const other = await syncedOwner('2026-10-17');
		await fixtures.createTransactions(bankAccount, [
			// History starts mid-March, so March is no complete month.
			bookedRow('2026-03-10', '-999.00'),
			...USUAL_MONTHS.flatMap((month) => [
				bookedRow(`${month}-05`, '-100.00'),
				bookedRow(`${month}-20`, '-50.00'),
			]),
			// Neither a left-out row nor an own transfer counts.
			bookedRow('2026-09-03', '-1000.00', {leftOutOfTotals: true}),
			bookedRow('2026-09-04', '-700.00', {category: null, ownTransferEvidence: 'IBAN'}),
			bookedRow('2026-09-25', '1800.00', {category: 'INCOME'}),
			bookedRow('2026-10-01', '2000.00', {category: 'INCOME'}),
			bookedRow('2026-10-02', '-30.00'),
			bookedRow('2026-10-15', '-20.00'),
			// After the last covered day.
			bookedRow('2026-10-16', '-500.00'),
			bookedRow('2026-10-16', '400.00', {category: 'INCOME'}),
		]);
		await fixtures.createTransactions(other.bankAccount, [bookedRow('2026-10-02', '-999.00')]);

		const {body} = (await agent.get(PACE).query({asOf: AS_OF}).expect(200)) as {body: SpendingPace};

		expect(body).toMatchObject({
			baseCurrency: 'EUR',
			month: '2026-10',
			daysInMonth: 31,
			lastCoveredDay: '2026-10-15',
			spending: '50.00',
			income: '2000.00',
			usual: {months: USUAL_MONTHS, byLastCoveredDay: '100.00', month: '150.00'},
		});
		expect(body.daily).toHaveLength(15);
		expect(body.daily[1]).toEqual({day: 2, spending: '30.00', cumulative: '30.00'});
		expect(body.daily[14]).toEqual({day: 15, spending: '20.00', cumulative: '50.00'});
		expect(body.usual!.daily).toHaveLength(31);
		expect(body.usual!.daily[19]).toEqual({day: 20, average: '150.00', low: '150.00', high: '150.00'});
	});

	it('shows no usual pace under two complete months, and nothing of this month before any data covers it', async () => {
		const {agent, bankAccount} = await syncedOwner(null);
		await fixtures.createTransactions(bankAccount, [
			bookedRow('2026-09-01', '-80.00'),
			bookedRow('2026-10-03', '-12.00'),
		]);

		const {body} = (await agent.get(PACE).query({asOf: AS_OF}).expect(200)) as {body: SpendingPace};

		expect(body).toMatchObject({lastCoveredDay: null, daily: [], spending: '0.00', income: '0.00', usual: null});
	});

	it('counts a month from the first day the sync recorded covering, though nothing was booked on it', async () => {
		const {agent, bankAccount} = await syncedOwner('2026-10-14');
		await fixtures.bankAccounts.update({id: bankAccount.id}, {syncCoveredFrom: '2026-08-01'});
		await fixtures.createTransactions(bankAccount, [
			bookedRow('2026-08-03', '-100.00'),
			bookedRow('2026-09-05', '-300.00'),
		]);

		const {body} = (await agent.get(PACE).query({asOf: AS_OF}).expect(200)) as {body: SpendingPace};

		expect(body.usual).toMatchObject({months: ['2026-08', '2026-09'], month: '200.00'});

		// Without recorded coverage the data starts at its first booking, so August is not whole.
		const unrecorded = await syncedOwner('2026-10-14');
		await fixtures.createTransactions(unrecorded.bankAccount, [
			bookedRow('2026-08-03', '-100.00'),
			bookedRow('2026-09-05', '-300.00'),
		]);
		const pace = (await unrecorded.agent.get(PACE).query({asOf: AS_OF}).expect(200)).body as SpendingPace;
		expect(pace.usual).toBeNull();
	});

	it('leaves out the days before a reconnect’s sync coverage, and takes a gap nothing records as covered', async () => {
		const history = [
			bookedRow('2026-01-05', '-10.00'),
			bookedRow('2026-03-20', '-20.00'),
			bookedRow('2026-06-02', '-30.00'),
		];
		// The bank synced from January to 20 March; after reconnecting, sync recorded covering from 2 June.
		const reconnected = await syncedOwner('2026-10-14');
		await fixtures.bankAccounts.update({id: reconnected.bankAccount.id}, {syncCoveredFrom: '2026-06-02'});
		await fixtures.createTransactions(reconnected.bankAccount, history);
		// The same rows from a bank whose sync records no coverage.
		const unrecorded = await syncedOwner('2026-10-14');
		await fixtures.createTransactions(unrecorded.bankAccount, history);

		const months = async ({agent}: {agent: TestAgent}) =>
			((await agent.get(PACE).query({asOf: AS_OF}).expect(200)).body as SpendingPace).usual?.months;

		expect(await months(reconnected)).toEqual(['2026-02', '2026-07', '2026-08', '2026-09']);
		expect(await months(unrecorded)).toEqual(USUAL_MONTHS);
	});

	it('leaves out a statement gap’s missing days, including an end cut at sync coverage, until sync covers them', async () => {
		const gapped = async (sync: {from: string; through: string}, gap: {from: string; to: string}) => {
			const synced = await syncedOwner('2026-10-14');
			await fixtures.bankAccounts.update(
				{id: synced.bankAccount.id},
				{syncCoveredFrom: sync.from, syncCoveredThrough: sync.through},
			);
			await fixtures.createTransactions(synced.bankAccount, [bookedRow(sync.from, '-10.00')]);
			await imports.save({
				accountId: synced.owner.id,
				bankConnectionId: synced.connection.id,
				fileHash: `pace-gap-${gap.from}-${sync.through}`,
				format: 'camt053',
				filesCount: 2,
				rowsParsed: 2,
				rowsAdded: 2,
				rowsAlreadyPresent: 0,
				dateFrom: '2026-08-20',
				dateTo: '2026-09-30',
				bankAccountIds: [synced.bankAccount.id],
				createdBankAccountIds: [],
				statementGaps: [{bankAccountId: synced.bankAccount.id, ...gap, amount: '-5.00', currency: 'EUR'}],
			});
			return ((await synced.agent.get(PACE).query({asOf: AS_OF}).expect(200)).body as SpendingPace).usual?.months;
		};

		// Sync covered June to August when the statements came in; the importer cut the gap to 1 and 2 September.
		expect(
			await gapped({from: '2026-06-01', through: '2026-08-31'}, {from: '2026-09-01', to: '2026-09-02'}),
		).toEqual(['2026-06', '2026-07', '2026-08']);
		// Sync has since fetched September completely, so the gap the statements left is in.
		expect(
			await gapped({from: '2026-06-01', through: '2026-10-14'}, {from: '2026-08-31', to: '2026-10-01'}),
		).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
	});

	it('leaves a hidden account out of the coverage and the pace', async () => {
		const {agent, bankAccount} = await syncedOwner('2026-10-14');
		await fixtures.createTransactions(bankAccount, [bookedRow('2026-10-02', '-40.00')]);
		await fixtures.bankAccounts.update({id: bankAccount.id}, {isHidden: true});

		const coverage = (await agent.get(COVERAGE).query({asOf: AS_OF}).expect(200)).body as DataCoverage;
		const pace = (await agent.get(PACE).query({asOf: AS_OF}).expect(200)).body as SpendingPace;

		expect(coverage).toMatchObject({lastCoveredDay: null, accounts: []});
		expect(pace).toMatchObject({lastCoveredDay: null, daily: [], spending: '0.00'});
	});

	it('refuses a date that is not a calendar date', async () => {
		const {agent} = await syncedOwner(null);

		await agent.get(PACE).query({asOf: '2026-02-30'}).expect(400);
		await agent.get(COVERAGE).query({asOf: 'today'}).expect(400);
	});

	describe('coverage', () => {
		// Each import runs the whole file pipeline, as the import specs allow for.
		jest.setTimeout(30_000);

		const debit = (bookingDate: string): CamtEntry => ({amount: '5.00', bookingDate, info: 'Example Shop'});
		const statement = (days: string[]) => Buffer.from(camt053([{entries: days.map(debit)}]));

		function importFile(agent: TestAgent, file: Buffer) {
			return agent.post('/bank-imports').attach('files', file, 'upload-0.bin').expect(201);
		}

		it('lists each account’s covered days in the last 30, from its first row through its last fetch or import', async () => {
			const {agent, connection, bankAccount: synced} = await syncedOwner('2026-10-15');
			await fixtures.bankAccounts.update({id: synced.id}, {syncCoveredFrom: '2026-10-05'});
			// The connection's newest sync skipped this account, so it stays at its earlier fetch.
			const skipped = await fixtures.createBankAccount(connection, {
				providerAccountId: 'skipped-account',
				identificationHash: 'skipped-account-hash',
				syncCoveredFrom: '2026-10-01',
				transactionsFetchedThrough: '2026-10-10',
			});
			const other = await syncedOwner('2026-10-17');
			const october = (await importFile(agent, statement(['2026-10-01', '2026-10-09'])))
				.body as BankImportSummary;
			const september = (await importFile(agent, statement(['2026-09-25', '2026-09-28'])))
				.body as BankImportSummary;
			const file = october.accounts[0].id;
			expect(september.accounts.map(({id}) => id)).toEqual([file]);

			const {body} = (await agent.get(COVERAGE).query({asOf: AS_OF}).expect(200)) as {body: DataCoverage};

			expect(body).toEqual({
				from: '2026-09-19',
				to: AS_OF,
				lastCoveredDay: '2026-10-15',
				accounts: expect.arrayContaining([
					{
						bankAccountId: synced.id,
						source: 'sync',
						coveredThrough: '2026-10-15',
						ranges: [{from: '2026-10-05', to: '2026-10-15'}],
					},
					{
						bankAccountId: skipped.id,
						source: 'sync',
						coveredThrough: '2026-10-10',
						ranges: [{from: '2026-10-01', to: '2026-10-10'}],
					},
					{
						// Nothing records missing days between the two files, so they count as covered.
						bankAccountId: file,
						source: 'file',
						coveredThrough: '2026-10-09',
						ranges: [{from: '2026-09-25', to: '2026-10-09'}],
					},
				]),
			});
			expect(body.accounts).toHaveLength(3);

			// A day before the last fetch: nothing after it counts.
			const earlier = (await agent.get(COVERAGE).query({asOf: '2026-10-08'}).expect(200)).body as DataCoverage;
			expect(earlier.lastCoveredDay).toBe('2026-10-08');
			expect(earlier.accounts.find(({bankAccountId}) => bankAccountId === file)).toMatchObject({
				coveredThrough: '2026-10-08',
				ranges: [{from: '2026-09-25', to: '2026-10-08'}],
			});

			// Another owner sees only their own account, from its first transaction, cut to the window.
			await fixtures.createTransactions(other.bankAccount, [bookedRow('2026-09-02', '-20.00')]);
			const theirs = (await other.agent.get(COVERAGE).query({asOf: AS_OF}).expect(200)).body as DataCoverage;
			expect(theirs).toMatchObject({
				lastCoveredDay: '2026-10-17',
				accounts: [
					{
						bankAccountId: other.bankAccount.id,
						coveredThrough: '2026-10-17',
						ranges: [{from: '2026-09-19', to: '2026-10-17'}],
					},
				],
			});
			expect(theirs.accounts).toHaveLength(1);
		});

		it('leaves out an undone import', async () => {
			const {agent} = await syncedOwner(null);
			const october = (await importFile(agent, statement(['2026-10-01', '2026-10-09'])))
				.body as BankImportSummary;
			await importFile(agent, statement(['2026-09-25', '2026-09-28']));
			const file = october.accounts[0].id;

			await agent.delete(`/bank-imports/${october.id}`).expect(204);

			const {body} = (await agent.get(COVERAGE).query({asOf: AS_OF}).expect(200)) as {body: DataCoverage};
			expect(body.accounts.find(({bankAccountId}) => bankAccountId === file)).toEqual({
				bankAccountId: file,
				source: 'file',
				coveredThrough: '2026-09-28',
				ranges: [{from: '2026-09-25', to: '2026-09-28'}],
			});
		});

		it('leaves out the days between statements whose balances do not follow on, and covers each account of an upload through its end', async () => {
			const {agent, owner} = await syncedOwner(null);
			const balances = (opening: string, closing: string, openingDate: string, closingDate: string) => ({
				servicerBic: 'EXAMPLEXX',
				opening,
				closing,
				openingDate,
				closingDate,
			});
			const upload = Buffer.from(
				camt053([
					// Closes at 95.00 on 24 September; the next statement opens at 80.00 on 6 October.
					{entries: [debit('2026-09-21')], ...balances('100.00', '95.00', '2026-09-20', '2026-09-24')},
					{entries: [debit('2026-10-06')], ...balances('80.00', '75.00', '2026-10-06', '2026-10-08')},
					{iban: OTHER_EXAMPLE_IBAN, servicerBic: 'EXAMPLEXX', entries: [debit('2026-10-02')]},
				]),
			);
			const imported = (await importFile(agent, upload)).body as BankImportSummary;
			expect(imported.statementGaps).toHaveLength(1);
			// An account kept from a removed bank sits on the imported-files connection, fetched until the bank went.
			const files = await fixtures.connections.findOneByOrFail({accountId: owner.id, provider: 'file'});
			const kept = await fixtures.createBankAccount(files, {
				providerAccountId: 'kept-account',
				identificationHash: 'kept-account-hash',
				transactionsFetchedThrough: '2026-10-03',
			});
			await fixtures.createTransactions(kept, [bookedRow('2026-09-26', '-5.00')]);

			const {body} = (await agent.get(COVERAGE).query({asOf: AS_OF}).expect(200)) as {body: DataCoverage};
			const rangesOf = (id: string) => body.accounts.find(({bankAccountId}) => bankAccountId === id)?.ranges;
			const gapped = imported.statementGaps[0].bankAccountId;
			const second = imported.accounts.find(({id}) => id !== gapped)!.id;

			expect(rangesOf(gapped)).toEqual([
				{from: '2026-09-21', to: '2026-09-24'},
				{from: '2026-10-06', to: '2026-10-06'},
			]);
			// The upload ends on its last booking, 6 October: the date Accounts shows for each of its accounts.
			expect(rangesOf(second)).toEqual([{from: '2026-10-02', to: '2026-10-06'}]);
			expect(rangesOf(kept.id)).toEqual([{from: '2026-09-26', to: '2026-10-03'}]);
		});

		it('ends the pace at an import into a synced account that runs past its last fetch', async () => {
			const {agent, connection} = await syncedOwner(null);
			const synced = await fixtures.createBankAccount(connection, {
				iban: EXAMPLE_IBAN,
				transactionsFetchedThrough: '2026-10-04',
			});
			const imported = (await importFile(agent, statement(['2026-10-02', '2026-10-11'])))
				.body as BankImportSummary;
			expect(imported.accounts.map(({id}) => id)).toEqual([synced.id]);

			const {body} = (await agent.get(PACE).query({asOf: AS_OF}).expect(200)) as {body: SpendingPace};

			// Nothing covers 1 October, before the statement's first booking: its spending is unknown, not zero.
			expect(body).toMatchObject({
				lastCoveredDay: '2026-10-11',
				uncovered: [{from: 1, to: 1}],
				spending: '10.00',
			});
			expect(body.daily).toHaveLength(11);
		});
	});
});
