import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import TestAgent from 'supertest/lib/agent';
import {DataSource, Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';
import {
	BANKING_BALANCE_TREND_RANGE,
	BANKING_TRANSACTION_CASH_FLOW_RANGE,
	BANKING_TRANSACTION_SUMMARY_FUTURE_MONTH,
} from '@modules/banking/api/constants/banking-messages.constants';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {formatCents, parseCents} from '@modules/banking/summary/bank-transaction-summary';

import {BankingFixtures, CURRENCY_EXCHANGE_EVENT, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {
	SESSION_TEST_ACCOUNT_EMAIL,
	SESSION_TEST_ACCOUNT_PASSWORD,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';

const SUMMARY = '/bank-transactions/summary';
const CASH_FLOW = '/bank-transactions/cash-flow';
const OCTOBER = {month: '2026-10', asOf: '2026-10-18'};

describe('BankTransactionSummary', () => {
	let app: INestApplication;
	let fixtures: BankingFixtures;
	let accounts: Repository<Account>;
	let owner: Account;
	let otherOwner: Account;
	let ownerAgent: TestAgent;
	let otherAgent: TestAgent;
	let ownerBankAccount: BankAccount;
	let otherBankAccount: BankAccount;

	async function removeConnections() {
		await fixtures.connections
			.createQueryBuilder()
			.delete()
			.where('accountId IN (:...accountIds)', {accountIds: [owner.id, otherOwner.id]})
			.execute();
	}

	beforeAll(async () => {
		app = getApp();
		fixtures = new BankingFixtures(app);
		accounts = app.get(getRepositoryToken(Account));
		const accountService = app.get(AccountService);
		owner = (await accountService.findByEmail(VERIFIED_ACCOUNT_EMAIL))!;
		otherOwner = (await accountService.findByEmail(SESSION_TEST_ACCOUNT_EMAIL))!;
		ownerAgent = await loginAgent(app.getHttpServer(), VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		otherAgent = await loginAgent(app.getHttpServer(), SESSION_TEST_ACCOUNT_EMAIL, SESSION_TEST_ACCOUNT_PASSWORD);

		await removeConnections();
		await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
		await accounts.update({id: otherOwner.id}, {baseCurrency: null});
		ownerBankAccount = await fixtures.createBankAccount(await fixtures.createConnection(owner));
		const ownerGbpAccount = await fixtures.createBankAccount(await fixtures.createConnection(owner), {
			currency: 'GBP',
		});
		otherBankAccount = await fixtures.createBankAccount(await fixtures.createConnection(otherOwner));
		const exchange = {
			category: null,
			categoryStatus: 'NOT_APPLICABLE',
			...CURRENCY_EXCHANGE_EVENT,
		};

		await fixtures.createTransactions(ownerBankAccount, [
			// Baseline months.
			bookedRow('2026-07-05', '-20.00', {category: 'FOOD_AND_DRINK'}),
			bookedRow('2026-07-10', '1000.00', {category: 'INCOME'}),
			bookedRow('2026-07-20', '-100.00', {category: 'FOOD_AND_DRINK'}),
			bookedRow('2026-08-18', '-30.00', {category: 'FOOD_AND_DRINK'}),
			bookedRow('2026-08-31', '-300.00'),
			bookedRow('2026-09-01', '-60.00', {category: 'TRANSFER_OUT'}),
			bookedRow('2026-09-30', '-15.00', {category: 'FOOD_AND_DRINK'}),
			// Viewed month.
			bookedRow('2026-10-01', '-12.30', {category: 'FOOD_AND_DRINK'}),
			bookedRow('2026-10-03', '-7.70', {category: 'FOOD_AND_DRINK'}),
			bookedRow('2026-10-05', '-50.00', {category: 'TRANSFER_OUT'}),
			bookedRow('2026-10-06', '5.00', {category: 'REFUND'}),
			bookedRow('2026-10-07', '-3.00', {category: null}),
			bookedRow('2026-10-08', '2000.00', {category: 'INCOME'}),
			bookedRow('2026-10-09', '-100.00', {category: null, ownTransferEvidence: 'IBAN'}),
			bookedRow('2026-10-09', '100.00', {category: null, ownTransferEvidence: 'IBAN'}),
			bookedRow('2026-10-10', '-40.00', exchange),
			bookedRow('2026-10-11', '-1.00', {creditDebitIndicator: null}),
			bookedRow('2026-10-12', '-9.99', {amountInBaseCurrency: null}),
			// After the cut-off day, and not booked yet.
			bookedRow('2026-10-19', '-1000.00', {category: 'FOOD_AND_DRINK'}),
			bookedRow(null, '-20.00', {transactionStatus: 'PDNG'}),
		]);
		await fixtures.createTransactions(ownerGbpAccount, [
			bookedRow('2026-10-02', '-10.00', {
				currency: 'GBP',
				amountInBaseCurrency: '-11.60',
				category: 'FOOD_AND_DRINK',
			}),
		]);
		await fixtures.createTransactions(otherBankAccount, [
			bookedRow('2026-09-10', '-40.00', {category: 'FOOD_AND_DRINK'}),
			// A credit not categorized yet still counts as income.
			bookedRow('2026-09-12', '25.00', {category: null}),
			bookedRow('2026-10-02', '-999.00', {category: 'FOOD_AND_DRINK'}),
		]);
	});

	afterAll(async () => {
		await removeConnections();
	});

	it('summarizes spending, income and pace for a month against the three before it', async () => {
		const response = await ownerAgent.get(SUMMARY).query(OCTOBER).expect(200);
		const body = response.body;

		expect(body).toMatchObject({
			month: '2026-10',
			through: '2026-10-18',
			daysInMonth: 31,
			baseCurrency: 'EUR',
			totals: {spending: '79.60', income: '2000.00', net: '1920.40', ownTransfers: '100.00'},
			excluded: {unknownDirection: 1, missingBaseAmount: 1},
		});
		expect(body.daily).toHaveLength(18);
		expect(body.daily.slice(0, 7)).toEqual([
			{day: 1, spending: '12.30', cumulative: '12.30'},
			{day: 2, spending: '11.60', cumulative: '23.90'},
			{day: 3, spending: '7.70', cumulative: '31.60'},
			{day: 4, spending: '0.00', cumulative: '31.60'},
			{day: 5, spending: '50.00', cumulative: '81.60'},
			{day: 6, spending: '-5.00', cumulative: '76.60'},
			{day: 7, spending: '3.00', cumulative: '79.60'},
		]);
		expect(body.daily[17]).toEqual({day: 18, spending: '0.00', cumulative: '79.60'});

		expect(body.baseline).toMatchObject({
			months: ['2026-07', '2026-08', '2026-09'],
			spendingByThrough: '36.67',
			spendingRangeByThrough: {low: '20.00', high: '60.00'},
			incomeByThrough: '333.33',
		});
		expect(body.baseline.daily).toHaveLength(31);
		expect(body.baseline.daily[17]).toEqual({day: 18, average: '36.67', low: '20.00', high: '60.00'});
		// September stops at day 30.
		expect(body.baseline.daily[30]).toEqual({day: 31, average: '175.00', low: '75.00', high: '330.00'});

		expect(body.categories).toEqual([
			{category: 'TRANSFER_OUT', spending: '50.00', count: 1, baselineAverage: '20.00'},
			{category: 'FOOD_AND_DRINK', spending: '31.60', count: 3, baselineAverage: '16.67'},
			{category: 'UNCATEGORIZED', spending: '3.00', count: 1, baselineAverage: null},
			{category: 'REFUND', spending: '-5.00', count: 1, baselineAverage: null},
		]);
	});

	/** Sums the list filtered the way a dashboard drill link does, in cents, as the summary signs it. */
	async function listed(
		cashFlow: 'SPENDING' | 'INCOME',
		from: string,
		to: string,
		filter: Record<string, string> = {},
	) {
		const {body} = await ownerAgent
			.get('/bank-transactions')
			.query({
				'filter[cashFlows][]': cashFlow,
				'filter[baseAmount]': 'PRESENT',
				'filter[bookingDate][from]': from,
				'filter[bookingDate][to]': to,
				'pagination[pageSize]': '100',
				...filter,
			})
			.expect(200);
		const cents = body.transactions.reduce(
			(total: bigint, {amountInBaseCurrency}: {amountInBaseCurrency: string}) =>
				total + parseCents(amountInBaseCurrency),
			0n,
		);
		return {amount: formatCents(cashFlow === 'SPENDING' ? -cents : cents), count: body.total};
	}

	async function expectCategoriesReconcile(
		summary: {through: string; categories: Array<Record<string, unknown>>},
		from: string,
	) {
		for (const {category, spending, count} of summary.categories) {
			expect(await listed('SPENDING', from, summary.through, {'filter[categories][]': String(category)})).toEqual(
				{
					amount: spending,
					count,
				},
			);
		}
	}

	it('reconciles totals and categories with the filtered transaction list', async () => {
		const {body: summary} = await ownerAgent.get(SUMMARY).query(OCTOBER).expect(200);
		const from = '2026-10-01';

		expect((await listed('SPENDING', from, summary.through)).amount).toBe(summary.totals.spending);
		expect((await listed('INCOME', from, summary.through)).amount).toBe(summary.totals.income);
		await expectCategoriesReconcile(summary, from);
	});

	it('keys review, refund debits and canonical indicators like the list on the first of a month', async () => {
		const extra = await fixtures.createTransactions(ownerBankAccount, [
			bookedRow('2026-11-01', '-4.00', {category: 'NEEDS_REVIEW'}),
			bookedRow('2026-11-01', '-2.00', {category: 'REFUND'}),
			bookedRow('2026-11-01', '-1.50', {creditDebitIndicator: 'DBIT'}),
			bookedRow('2026-11-01', '10.00', {creditDebitIndicator: 'CRDT', category: 'INCOME'}),
			bookedRow('2026-11-02', '-99.00'),
		]);

		try {
			const {body: summary} = await ownerAgent
				.get(SUMMARY)
				.query({month: '2026-11', asOf: '2026-11-01'})
				.expect(200);

			expect(summary).toMatchObject({
				through: '2026-11-01',
				totals: {spending: '7.50', income: '10.00', net: '2.50'},
				baseline: {months: ['2026-08', '2026-09', '2026-10']},
			});
			expect(summary.daily).toEqual([{day: 1, spending: '7.50', cumulative: '7.50'}]);
			expect(summary.categories).toEqual([
				{category: 'NEEDS_REVIEW', spending: '4.00', count: 1, baselineAverage: null},
				{category: 'SHOPPING', spending: '1.50', count: 1, baselineAverage: '0.00'},
				{category: 'REFUND', spending: '2.00', count: 1, baselineAverage: null},
			]);
			expect((await listed('INCOME', '2026-11-01', summary.through)).amount).toBe('10.00');
			await expectCategoriesReconcile(summary, '2026-11-01');
		} finally {
			await fixtures.transactions.delete(extra.map(({id}) => id));
		}
	});

	it('uses only months with history, and leaves out another owner’s rows', async () => {
		const {body} = await otherAgent.get(SUMMARY).query(OCTOBER).expect(200);

		expect(body.totals.spending).toBe('999.00');
		expect(body.baseline).toMatchObject({months: ['2026-09'], spendingRangeByThrough: null});
		expect(body.baseline.daily[17]).toEqual({day: 18, average: '40.00', low: null, high: null});
		expect(body.categories).toEqual([
			{category: 'FOOD_AND_DRINK', spending: '999.00', count: 1, baselineAverage: '40.00'},
		]);
	});

	it('compares a past month with whole earlier months, including their 31st', async () => {
		const {body} = await ownerAgent.get(SUMMARY).query({month: '2026-09', asOf: '2026-10-18'}).expect(200);

		expect(body).toMatchObject({through: '2026-09-30', daysInMonth: 30, totals: {spending: '75.00'}});
		expect(body.daily).toHaveLength(30);
		// August's spending on the 31st counts: 120.00 in July, 330.00 in August.
		expect(body.baseline).toMatchObject({
			months: ['2026-07', '2026-08'],
			spendingByThrough: '225.00',
			spendingRangeByThrough: {low: '120.00', high: '330.00'},
			incomeByThrough: '500.00',
		});
		// The pace chart still compares the same days; the headline uses whole months.
		expect(body.baseline.daily[29]).toEqual({day: 30, average: '75.00', low: '30.00', high: '120.00'});
		expect(body.categories).toEqual([
			{category: 'TRANSFER_OUT', spending: '60.00', count: 1, baselineAverage: '0.00'},
			{category: 'FOOD_AND_DRINK', spending: '15.00', count: 1, baselineAverage: '75.00'},
		]);
	});

	it('keeps same-day comparisons on the last day of the current month', async () => {
		const {body} = await ownerAgent.get(SUMMARY).query({month: '2026-09', asOf: '2026-09-30'}).expect(200);
		expect(body.baseline).toMatchObject({
			spendingByThrough: '75.00',
			spendingRangeByThrough: {low: '30.00', high: '120.00'},
		});
	});

	it('includes every day of longer baseline months when viewing completed February', async () => {
		const extra = await fixtures.createTransactions(ownerBankAccount, [
			bookedRow('2027-01-28', '-10.00', {category: 'FOOD_AND_DRINK'}),
			bookedRow('2027-01-31', '-90.00', {category: 'FOOD_AND_DRINK'}),
			bookedRow('2027-01-31', '300.00', {category: 'INCOME'}),
			bookedRow('2027-02-01', '-15.00', {category: 'FOOD_AND_DRINK'}),
		]);
		try {
			const {body} = await ownerAgent.get(SUMMARY).query({month: '2027-02', asOf: '2027-03-01'}).expect(200);
			expect(body.baseline).toMatchObject({
				months: ['2026-11', '2026-12', '2027-01'],
				spendingByThrough: '33.33',
				spendingRangeByThrough: {low: '0.00', high: '100.00'},
				incomeByThrough: '100.00',
			});
			expect(body.baseline.daily[27]).toEqual({day: 28, average: '3.33', low: '0.00', high: '10.00'});
			expect(body.categories).toEqual([
				{category: 'FOOD_AND_DRINK', spending: '15.00', count: 1, baselineAverage: '33.33'},
			]);
		} finally {
			await fixtures.transactions.delete(extra.map(({id}) => id));
		}
	});

	it('compares with nothing before the first booked transaction', async () => {
		const {body} = await ownerAgent.get(SUMMARY).query({month: '2026-07', asOf: '2026-10-18'}).expect(200);

		expect(body.baseline).toEqual({
			months: [],
			daily: [],
			spendingByThrough: null,
			spendingRangeByThrough: null,
			incomeByThrough: null,
		});
		expect(body.categories).toEqual([
			{category: 'FOOD_AND_DRINK', spending: '120.00', count: 2, baselineAverage: null},
		]);
	});

	it.each([
		['a missing month', {asOf: '2026-10-18'}],
		['a month out of range', {month: '2026-13', asOf: '2026-10-18'}],
		['a malformed month', {month: '2026-1', asOf: '2026-10-18'}],
		['a two-digit year', {month: '0050-04', asOf: '2026-10-18'}],
		['a missing day', {month: '2026-10'}],
		['an impossible day', {month: '2026-10', asOf: '2026-02-30'}],
		['a month after the given day', {month: '2026-11', asOf: '2026-10-18'}],
	])('rejects %s', async (_case, query) => {
		await ownerAgent.get(SUMMARY).query(query).expect(400);
	});

	it('explains why a month after the given day is rejected', async () => {
		const {body} = await ownerAgent.get(SUMMARY).query({month: '2026-11', asOf: '2026-10-31'}).expect(400);
		expect(body.message).toBe(BANKING_TRANSACTION_SUMMARY_FUTURE_MONTH);
	});

	it('counts transactions that need attention across all months', async () => {
		const extra = await fixtures.createTransactions(ownerBankAccount, [
			bookedRow('2026-07-15', '-5.00', {category: 'NEEDS_REVIEW'}),
			bookedRow(null, '-6.00', {category: null, categoryStatus: 'FAILED', amountInBaseCurrency: null}),
			bookedRow('2026-08-03', '-7.00', {category: null, categoryStatus: 'PROCESSING'}),
		]);
		const otherExtra = await fixtures.createTransaction(
			otherBankAccount,
			bookedRow('2026-08-03', '-8.00', {category: 'NEEDS_REVIEW'}),
		);

		try {
			const {body} = await ownerAgent.get('/bank-transactions/review-counts').expect(200);
			expect(body).toEqual({
				needsReview: 1,
				categorizationFailed: 1,
				categorizing: 1,
				unknownDirection: 1,
				missingBaseAmount: 2,
			});

			// Each count opens a list with exactly that many rows.
			const listTotal = async (filter: Record<string, string | string[]>) =>
				(await ownerAgent.get('/bank-transactions').query(filter).expect(200)).body.total;
			expect({
				needsReview: await listTotal({'filter[categories][]': 'NEEDS_REVIEW'}),
				categorizationFailed: await listTotal({'filter[categoryStatuses][]': 'FAILED'}),
				categorizing: await listTotal({'filter[categoryStatuses][]': 'CATEGORIZING'}),
				unknownDirection: await listTotal({'filter[cashFlows][]': 'UNKNOWN'}),
				missingBaseAmount: await listTotal({
					'filter[baseAmount]': 'MISSING',
					'filter[cashFlows][]': ['SPENDING', 'INCOME', 'UNKNOWN'],
				}),
			}).toEqual(body);
		} finally {
			await fixtures.transactions.delete([...extra.map(({id}) => id), otherExtra.id]);
		}
	});

	describe('cash flow', () => {
		const period = (start: string, end: string, complete: boolean, spending: string, income: string) => ({
			start,
			end,
			complete,
			spending,
			income,
			net: formatCents(parseCents(income) - parseCents(spending)),
		});

		it('totals each month from the first booking, cutting the running month at the given day', async () => {
			const {body} = await ownerAgent
				.get(CASH_FLOW)
				.query({interval: 'month', from: '2026-05-20', to: '2026-10-18', asOf: '2026-10-18'})
				.expect(200);

			expect(body).toEqual({
				baseCurrency: 'EUR',
				interval: 'month',
				periods: [
					// History starts on 5 July, so July is a partial month.
					period('2026-07-01', '2026-07-31', false, '120.00', '1000.00'),
					period('2026-08-01', '2026-08-31', true, '330.00', '0.00'),
					period('2026-09-01', '2026-09-30', true, '75.00', '0.00'),
					period('2026-10-01', '2026-10-18', false, '79.60', '2000.00'),
				],
			});
		});

		it('matches the monthly summary totals for every month', async () => {
			const {body} = await ownerAgent
				.get(CASH_FLOW)
				.query({interval: 'month', from: '2026-07-01', to: '2026-10-18', asOf: '2026-10-18'})
				.expect(200);
			for (const row of body.periods) {
				const {body: summary} = await ownerAgent
					.get(SUMMARY)
					.query({month: row.start.slice(0, 7), asOf: '2026-10-18'})
					.expect(200);
				expect([row.spending, row.income, row.net]).toEqual([
					summary.totals.spending,
					summary.totals.income,
					summary.totals.net,
				]);
			}
		});

		it('groups weeks from Monday and reconciles each with the filtered list', async () => {
			const {body} = await ownerAgent
				.get(CASH_FLOW)
				.query({interval: 'week', from: '2026-09-30', to: '2026-10-18', asOf: '2026-10-18'})
				.expect(200);

			expect(body.periods).toEqual([
				period('2026-09-28', '2026-10-04', true, '46.60', '0.00'),
				period('2026-10-05', '2026-10-11', true, '48.00', '2000.00'),
				// The week ends today, so it is still running.
				period('2026-10-12', '2026-10-18', false, '0.00', '0.00'),
			]);
			for (const row of body.periods) {
				expect((await listed('SPENDING', row.start, row.end)).amount).toBe(row.spending);
				expect((await listed('INCOME', row.start, row.end)).amount).toBe(row.income);
			}
		});

		it('totals whole years and leaves out another owner’s rows', async () => {
			const {body} = await otherAgent
				.get(CASH_FLOW)
				.query({interval: 'year', from: '2024-03-01', to: '2026-12-02', asOf: '2026-12-02'})
				.expect(200);

			expect(body).toEqual({
				baseCurrency: null,
				interval: 'year',
				periods: [period('2026-01-01', '2026-12-02', false, '1039.00', '25.00')],
			});
		});

		it('counts an uncategorized credit as income, as the monthly summary does', async () => {
			const [{body: flow}, {body: summary}] = await Promise.all([
				otherAgent
					.get(CASH_FLOW)
					.query({interval: 'month', from: '2026-09-01', to: '2026-09-30', asOf: '2026-10-18'})
					.expect(200),
				otherAgent.get(SUMMARY).query({month: '2026-09', asOf: '2026-10-18'}).expect(200),
			]);

			expect(flow.periods).toEqual([period('2026-09-01', '2026-09-30', false, '40.00', '25.00')]);
			expect([flow.periods[0].spending, flow.periods[0].income]).toEqual([
				summary.totals.spending,
				summary.totals.income,
			]);
		});

		it('marks a first week that starts before the history as partial', async () => {
			const {body} = await ownerAgent
				.get(CASH_FLOW)
				.query({interval: 'week', from: '2026-07-01', to: '2026-07-12', asOf: '2026-10-18'})
				.expect(200);

			expect(body.periods).toEqual([
				// History starts on Sunday 5 July.
				period('2026-06-29', '2026-07-05', false, '20.00', '0.00'),
				period('2026-07-06', '2026-07-12', true, '0.00', '1000.00'),
			]);
		});

		it.each([
			['104 weeks', {interval: 'week', from: '2024-10-21', to: '2026-10-18', asOf: '2026-10-18'}],
			['60 months', {interval: 'month', from: '2021-11-01', to: '2026-10-18', asOf: '2026-10-18'}],
			['10 years', {interval: 'year', from: '2017-01-01', to: '2026-10-18', asOf: '2026-10-18'}],
		])('accepts exactly %s', async (_case, query) => {
			await ownerAgent.get(CASH_FLOW).query(query).expect(200);
		});

		it.each([
			[
				'a range that runs backwards',
				{interval: 'month', from: '2026-10-02', to: '2026-10-01', asOf: '2026-10-01'},
			],
			['more than 104 weeks', {interval: 'week', from: '2024-10-01', to: '2026-10-18', asOf: '2026-10-18'}],
			['more than 60 months', {interval: 'month', from: '2021-10-01', to: '2026-10-18', asOf: '2026-10-18'}],
			['more than 10 years', {interval: 'year', from: '2016-12-31', to: '2026-10-18', asOf: '2026-10-18'}],
			[
				'an end after the given date',
				{interval: 'month', from: '2026-10-01', to: '2026-10-19', asOf: '2026-10-18'},
			],
		])('explains why it rejects %s', async (_case, query) => {
			const {body} = await ownerAgent.get(CASH_FLOW).query(query).expect(400);
			expect(body.message).toBe(BANKING_TRANSACTION_CASH_FLOW_RANGE);
		});

		it.each([
			['an unknown interval', {interval: 'day', from: '2026-10-01', to: '2026-10-18', asOf: '2026-10-18'}],
			['a month instead of a day', {interval: 'month', from: '2026-01', to: '2026-10-18', asOf: '2026-10-18'}],
			['a missing end', {interval: 'month', from: '2026-01-01'}],
			['a missing date', {interval: 'month', from: '2026-01-01', to: '2026-10-18'}],
			['an impossible day', {interval: 'month', from: '2026-01-01', to: '2026-02-30', asOf: '2026-02-30'}],
		])('rejects %s', async (_case, query) => {
			await ownerAgent.get(CASH_FLOW).query(query).expect(400);
		});
	});
	describe('balance trend', () => {
		const TREND = '/bank-transactions/balance-trend';
		let euroAccount: BankAccount;
		let kronaAccount: BankAccount;

		beforeAll(async () => {
			const connection = await fixtures.createConnection(owner);
			[euroAccount, kronaAccount] = await fixtures.createBankAccounts(connection, [
				{currency: 'EUR', currentBalanceAmount: '1000.00'},
				{currency: 'SEK', currentBalanceAmount: '10000.00'},
			]);
			// Left out: inactive, or on a connection that was cancelled.
			const inactive = await fixtures.createBankAccount(connection, {
				isActive: false,
				currentBalanceAmount: '5.00',
			});
			const cancelled = await fixtures.createBankAccount(
				await fixtures.createConnection(owner, {status: 'CANCELLED'}),
				{currentBalanceAmount: '7.00'},
			);
			await fixtures.createTransactions(euroAccount, [
				bookedRow('2019-01-10', '500.00'),
				bookedRow('2019-02-05', '-200.00'),
				bookedRow('2019-03-20', '300.00'),
				// Pending rows have no booking day yet, so they never move a past balance.
				bookedRow(null, '-50.00', {transactionStatus: 'PDNG'}),
			]);
			await fixtures.createTransactions(kronaAccount, [bookedRow('2019-02-15', '1000.00', {currency: 'SEK'})]);
			await fixtures.createTransactions(inactive, [bookedRow('2018-06-01', '5.00')]);
			await fixtures.createTransactions(cancelled, [bookedRow('2018-06-01', '7.00')]);
			await app.get(DataSource).query(
				`INSERT INTO "bank_transaction_fx_rates" ("currency", "rateDate", "rateToEur", "provider")
				VALUES ('SEK', '2019-02-28', 10, 'ECB'), ('SEK', '2019-03-29', 11, 'ECB')
				ON CONFLICT DO NOTHING`,
			);
		});

		it('rebuilds each month-end balance from today’s balances and converts it at that month’s rate', async () => {
			const {body} = await ownerAgent
				.get(TREND)
				.query({interval: 'month', from: '2018-12-01', to: '2019-03-31', asOf: '2026-10-18'})
				.expect(200);
			const balances = (euro: string | null, krona: string | null) =>
				[
					{id: euroAccount.id, balance: euro},
					{id: kronaAccount.id, balance: krona},
				].sort((a, b) => a.id.localeCompare(b.id));

			expect(body.baseCurrency).toBe('EUR');
			expect(body.interval).toBe('month');
			expect(body.accounts).toEqual(
				expect.arrayContaining([
					{id: euroAccount.id, since: '2019-01-10'},
					{id: kronaAccount.id, since: '2019-02-15'},
				]),
			);
			// December comes before any history, so it is left out.
			expect(
				body.periods.map((period: {accounts: {id: string}[]}) => ({
					...period,
					accounts: [...period.accounts].sort((a, b) => a.id.localeCompare(b.id)),
				})),
			).toEqual([
				// The krona account starts on 15 February.
				{
					start: '2019-01-01',
					end: '2019-01-31',
					complete: true,
					total: '900.00',
					accounts: balances('900.00', null),
				},
				{
					start: '2019-02-01',
					end: '2019-02-28',
					complete: true,
					total: '1700.00',
					accounts: balances('700.00', '1000.00'),
				},
				{
					start: '2019-03-01',
					end: '2019-03-31',
					complete: true,
					total: '1909.09',
					accounts: balances('1000.00', '909.09'),
				},
			]);
		});

		it('ends a running week at the given day, at the rate published by then', async () => {
			const {body} = await ownerAgent
				.get(TREND)
				.query({interval: 'week', from: '2019-03-18', to: '2019-03-20', asOf: '2019-03-20'})
				.expect(200);
			expect(body.periods).toEqual([
				expect.objectContaining({start: '2019-03-18', end: '2019-03-20', complete: false, total: '2000.00'}),
			]);
		});

		it('has no total where an account with history has no exchange rate yet', async () => {
			const {body} = await ownerAgent
				.get(TREND)
				.query({interval: 'week', from: '2019-02-18', to: '2019-02-24', asOf: '2026-10-18'})
				.expect(200);
			// No SEK rate is published before 28 February.
			expect(body.periods).toEqual([expect.objectContaining({end: '2019-02-24', total: null})]);
		});

		it('leaves another owner’s accounts out', async () => {
			const {body} = await otherAgent
				.get(TREND)
				.query({interval: 'year', from: '2019-01-01', to: '2019-12-31', asOf: '2026-10-18'})
				.expect(200);
			expect(body).toEqual({baseCurrency: null, interval: 'year', accounts: [], periods: []});
		});

		it.each([
			['a backwards range', {interval: 'month', from: '2019-03-01', to: '2019-01-31', asOf: '2026-10-18'}],
			[
				'a range past the given day',
				{interval: 'month', from: '2019-01-01', to: '2019-03-31', asOf: '2019-03-30'},
			],
			['more than 10 years', {interval: 'year', from: '2009-01-01', to: '2019-12-31', asOf: '2026-10-18'}],
		])('rejects %s', async (_, query) => {
			const response = await ownerAgent.get(TREND).query(query).expect(400);
			expect(response.body.message).toBe(BANKING_BALANCE_TREND_RANGE);
		});
	});
});
