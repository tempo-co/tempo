import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import type {BankImportSummary, DataCoverage, SpendingPace} from '@tempo/contracts';
import TestAgent from 'supertest/lib/agent';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BankingFixtures, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {type CamtEntry, camt053} from '../../fixtures/statement-file.fixture';
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

	beforeAll(() => {
		app = getApp();
		fixtures = new BankingFixtures(app);
		accounts = app.get(getRepositoryToken(Account));
	});

	/** A synced owner in Amsterdam whose connection last synced successfully at `syncedAt`, then failed once. */
	async function syncedOwner(syncedAt: string | null) {
		const synced = await createBankingOwner(app, {baseCurrency: 'EUR'});
		await accounts.update({id: synced.owner.id}, {timeZone: 'Europe/Amsterdam'});
		if (syncedAt) {
			await fixtures.createSyncRun(synced.connection, {status: 'SUCCEEDED', finishedAt: new Date(syncedAt)});
			await fixtures.createSyncRun(synced.connection, {
				status: 'PARTIAL',
				finishedAt: new Date('2026-10-17T08:00:00.000Z'),
			});
		}
		return synced;
	}

	it('adds up this month through the last covered day against the newest six complete months', async () => {
		// 22:30 UTC on 14 October is 15 October in Amsterdam.
		const {agent, bankAccount} = await syncedOwner('2026-10-14T22:30:00.000Z');
		const other = await syncedOwner('2026-10-17T10:00:00.000Z');
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

		it('lists each account’s covered days in the last 30, from its sync and its imports not undone', async () => {
			const {agent, bankAccount: synced} = await syncedOwner('2026-10-14T22:30:00.000Z');
			await fixtures.bankAccounts.update({id: synced.id}, {syncCoveredFrom: '2026-10-05'});
			const other = await syncedOwner('2026-10-17T10:00:00.000Z');
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
						bankAccountId: file,
						source: 'file',
						coveredThrough: '2026-10-09',
						ranges: [
							{from: '2026-09-25', to: '2026-09-28'},
							{from: '2026-10-01', to: '2026-10-09'},
						],
					},
				]),
			});
			expect(body.accounts).toHaveLength(2);

			// A day before the last sync: nothing after it counts.
			const earlier = (await agent.get(COVERAGE).query({asOf: '2026-10-08'}).expect(200)).body as DataCoverage;
			expect(earlier.lastCoveredDay).toBe('2026-10-08');
			expect(earlier.accounts.find(({bankAccountId}) => bankAccountId === file)).toMatchObject({
				coveredThrough: '2026-10-08',
				ranges: [
					{from: '2026-09-25', to: '2026-09-28'},
					{from: '2026-10-01', to: '2026-10-08'},
				],
			});

			// Another owner sees only their own account, its sync history from any day, cut to the window.
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

		it('leaves out an undone import, and joins days that follow on from covered ones', async () => {
			const {agent} = await syncedOwner(null);
			const october = (await importFile(agent, statement(['2026-10-01', '2026-10-09'])))
				.body as BankImportSummary;
			await importFile(agent, statement(['2026-09-25', '2026-09-28']));
			const file = october.accounts[0].id;
			const coverage = async () =>
				((await agent.get(COVERAGE).query({asOf: AS_OF}).expect(200)).body as DataCoverage).accounts.find(
					({bankAccountId}) => bankAccountId === file,
				);

			await agent.delete(`/bank-imports/${october.id}`).expect(204);
			expect(await coverage()).toEqual({
				bankAccountId: file,
				source: 'file',
				coveredThrough: '2026-09-28',
				ranges: [{from: '2026-09-25', to: '2026-09-28'}],
			});

			await importFile(agent, statement(['2026-09-29', '2026-09-30']));
			expect((await coverage())!.ranges).toEqual([{from: '2026-09-25', to: '2026-09-30'}]);

			// Days before the window are no part of it.
			await importFile(agent, statement(['2026-08-03', '2026-08-05']));
			expect(await coverage()).toMatchObject({
				coveredThrough: '2026-09-30',
				ranges: [{from: '2026-09-25', to: '2026-09-30'}],
			});
		});

		it('ends the pace at a file account’s newest import when no sync is newer', async () => {
			const {agent} = await syncedOwner('2026-09-30T08:00:00.000Z');
			await importFile(agent, statement(['2026-10-02', '2026-10-11']));

			const {body} = (await agent.get(PACE).query({asOf: AS_OF}).expect(200)) as {body: SpendingPace};

			expect(body).toMatchObject({lastCoveredDay: '2026-10-11', spending: '10.00'});
			expect(body.daily).toHaveLength(11);
		});
	});
});
