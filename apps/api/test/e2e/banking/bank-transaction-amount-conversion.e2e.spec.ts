import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import type {BankTransactionTotals, ReportingCurrency} from '@tempo/contracts';
import TestAgent from 'supertest/lib/agent';
import {DataSource, DeepPartial, In, Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankTransactionFxRate} from '@modules/banking/bank-transaction-fx-rate.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {lockReportingCurrencyForAmountWrites} from '@modules/banking/reporting-currency';
import {BankTransactionAmountConversionService} from '@modules/banking/services/bank-transaction-amount-conversion.service';
import {BankTransactionPersistenceService} from '@modules/banking/services/bank-transaction-persistence.service';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {
	SESSION_TEST_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';

// Synthetic reference rates (units of currency per 1 EUR).
const SYNTHETIC_RATES: Readonly<Record<string, string>> = {GBP: '0.800000', USD: '1.250000', RON: '5.000000'};
// Wednesday 2026-09-09, 17:00 in Berlin: that day's ECB rates should already be published.
const NOW = new Date('2026-09-09T15:00:00.000Z');
// The same Wednesday at 10:00 in Berlin, before that day's publication.
const BEFORE_PUBLICATION = new Date('2026-09-09T08:00:00.000Z');

const UNCONVERTED = {amountInBaseCurrency: null, baseAmountMethod: null, baseAmountRateDate: null};
const same = (amountInBaseCurrency: string) => ({
	amountInBaseCurrency,
	baseAmountMethod: 'SAME',
	baseAmountRateDate: null,
});
const ecb = (amountInBaseCurrency: string, baseAmountRateDate: string) => ({
	amountInBaseCurrency,
	baseAmountMethod: 'ECB',
	baseAmountRateDate,
});

describe('BankTransactionAmountConversionService', () => {
	let app: INestApplication;
	let fixtures: BankingFixtures;
	let fxRates: Repository<BankTransactionFxRate>;
	let accounts: Repository<Account>;
	let owner: Account;
	let otherOwner: Account;
	let service: BankTransactionAmountConversionService;
	let fetchSpy: jest.SpyInstance;
	let ecbRequests: Array<{currency: string; from: string; to: string}>;
	/** The newest date the synthetic ECB has published, or null when it is unavailable. */
	let publishedThrough: string | null;
	/** Weekdays without a synthetic ECB publication. */
	let holidays: Set<string>;

	beforeAll(async () => {
		app = getApp();
		fixtures = new BankingFixtures(app);
		fxRates = app.get(getRepositoryToken(BankTransactionFxRate));
		accounts = app.get(getRepositoryToken(Account));
		service = app.get(BankTransactionAmountConversionService);
		const accountService = app.get(AccountService);
		owner = (await accountService.findByEmail(VERIFIED_ACCOUNT_EMAIL))!;
		otherOwner = (await accountService.findByEmail(SESSION_TEST_ACCOUNT_EMAIL))!;
	});

	beforeEach(async () => {
		await fixtures.connections.createQueryBuilder().delete().execute();
		await fxRates.clear();
		await accounts
			.createQueryBuilder()
			.update()
			.set({baseCurrency: null, baseCurrencyState: null, baseCurrencyRevision: 0, baseAmountsRevision: 0})
			.execute();
		ecbRequests = [];
		publishedThrough = '2026-09-09';
		holidays = new Set();
		fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url = new URL(String(input));
			const currency = url.pathname.split('/').at(-1)!.split('.')[1];
			const from = url.searchParams.get('startPeriod')!;
			const to = url.searchParams.get('endPeriod')!;
			ecbRequests.push({currency, from, to});
			if (!publishedThrough) return new Response('Service Unavailable', {status: 503});
			return new Response(
				syntheticEcbCsv(currency, from, to < publishedThrough ? to : publishedThrough, holidays),
				{
					status: 200,
				},
			);
		});
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	async function createBankAccount(account: Account, currency: string, overrides: Partial<BankAccount> = {}) {
		const connection = await fixtures.createConnection(account);
		return fixtures.createBankAccount(connection, {currency, ...overrides});
	}

	/** Rows default to the bank account's currency, so each test only spells out what it varies. */
	function createRows(bankAccount: BankAccount, rows: DeepPartial<BankTransaction>[]) {
		return fixtures.createTransactions(
			bankAccount,
			rows.map((row) => ({currency: bankAccount.currency, ...row})),
		);
	}

	describe('rate refresh for account currencies', () => {
		it('fetches rates since the newest stored one for active foreign-currency accounts', async () => {
			await createBankAccount(owner, 'EUR');
			await createBankAccount(owner, 'USD');
			await fxRates.save({currency: 'USD', rateDate: '2026-09-01', rateToEur: '1.2', provider: 'ECB'});

			await service.backfill(NOW);

			expect(ecbRequests).toEqual([{currency: 'USD', from: '2026-09-01', to: '2026-09-09'}]);
			const latest = await fxRates.findOneByOrFail({currency: 'USD', rateDate: '2026-09-09'});
			expect(latest.rateToEur).toBe('1.250000000000');
		});

		it('fetches a recent window for a currency without any stored rate', async () => {
			await createBankAccount(otherOwner, 'GBP');

			await service.backfill(NOW);

			expect(ecbRequests).toEqual([{currency: 'GBP', from: '2026-09-02', to: '2026-09-09'}]);
		});

		it('does not fetch for up-to-date, EUR-only or inactive accounts', async () => {
			await createBankAccount(owner, 'EUR');
			await createBankAccount(owner, 'USD');
			await createBankAccount(owner, 'RON', {isActive: false});
			await fxRates.save({currency: 'USD', rateDate: '2026-09-09', rateToEur: '1.2', provider: 'ECB'});

			await service.backfill(NOW);

			expect(ecbRequests).toEqual([]);
		});
	});

	describe('conversion', () => {
		async function stored(id: string) {
			const {amountInBaseCurrency, baseAmountMethod, baseAmountRateDate} =
				await fixtures.transactions.findOneByOrFail({id});
			return {amountInBaseCurrency, baseAmountMethod, baseAmountRateDate};
		}

		it('stores exact cents with how each amount was converted', async () => {
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
			const eurAccount = await createBankAccount(owner, 'EUR');
			const gbpAccount = await createBankAccount(owner, 'GBP');
			const [sameCurrency, instructed, weekday, saturday, transactionDateFirst, noRate, staleRate] =
				await createRows(gbpAccount, [
					{currency: 'EUR', amount: '-12.34500000', bookingDate: '2026-09-04'},
					{amount: '-10.00', instructedAmount: '11.94', instructedCurrency: 'EUR', bookingDate: '2026-09-04'},
					{amount: '-10.00', bookingDate: '2026-09-04'},
					{amount: '-0.01', bookingDate: '2026-09-05'},
					{amount: '20.00', transactionDate: '2026-09-05', bookingDate: '2026-09-07'},
					{amount: '-10.00', currency: 'CHF', bookingDate: '2026-09-04'},
					{amount: '-10.00', currency: 'NOK', bookingDate: '2026-09-04'},
				]);
			const [eurRow] = await createRows(eurAccount, [{amount: '-1.005', bookingDate: '2026-09-04'}]);
			// Ten days before the transaction: too old to stand in for a missing publication.
			await fxRates.save({currency: 'NOK', rateDate: '2026-08-25', rateToEur: '11.5', provider: 'ECB'});

			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 8, converted: 6});

			expect(await stored(sameCurrency.id)).toEqual(same('-12.35'));
			// -1.005 rounds half away from zero.
			expect(await stored(eurRow.id)).toEqual(same('-1.01'));
			expect(await stored(instructed.id)).toEqual({
				amountInBaseCurrency: '-11.94',
				baseAmountMethod: 'INSTRUCTED',
				baseAmountRateDate: null,
			});
			expect(await stored(weekday.id)).toEqual(ecb('-12.50', '2026-09-04'));
			expect(await stored(saturday.id)).toEqual(ecb('-0.01', '2026-09-04'));
			expect(await stored(transactionDateFirst.id)).toEqual(ecb('25.00', '2026-09-04'));
			expect(await stored(noRate.id)).toEqual(UNCONVERTED);
			expect(await stored(staleRate.id)).toEqual(UNCONVERTED);
		});

		it('links same-day currency exchanges once their amounts are converted', async () => {
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
			const connection = await fixtures.createConnection(owner, {aspspName: 'Revolut'});
			const [eurAccount, usdAccount] = await fixtures.createBankAccounts(connection, [
				{currency: 'EUR'},
				{currency: 'USD'},
			]);
			const exchange = {
				bookingDate: '2026-09-04',
				description: 'Exchanged to USD',
				financialEventType: 'CURRENCY_EXCHANGE',
				financialEventSource: 'RULE',
			} as const;
			const [largeDebit, smallDebit] = await createRows(eurAccount, [
				{...exchange, amount: '-100.00', creditDebitIndicator: 'DBIT'},
				{...exchange, amount: '-20.00', creditDebitIndicator: 'DBIT'},
			]);
			// 124.50 USD and 25.10 USD are 99.60 EUR and 20.08 EUR at the synthetic rate.
			const [smallCredit, largeCredit] = await createRows(usdAccount, [
				{...exchange, amount: '25.10', creditDebitIndicator: 'CRDT'},
				{...exchange, amount: '124.50', creditDebitIndicator: 'CRDT'},
			]);
			const counterpartOf = async (id: string) =>
				(await fixtures.transactions.findOneByOrFail({id})).currencyExchangeCounterpartId;

			await service.backfill(NOW);

			expect(await counterpartOf(largeDebit.id)).toBe(largeCredit.id);
			expect(await counterpartOf(largeCredit.id)).toBe(largeDebit.id);
			expect(await counterpartOf(smallDebit.id)).toBe(smallCredit.id);
			expect(await counterpartOf(smallCredit.id)).toBe(smallDebit.id);
		});

		it("converts through EUR into each owner's own base currency", async () => {
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
			await accounts.update({id: otherOwner.id}, {baseCurrency: 'USD'});
			const [ownerRow] = await createRows(await createBankAccount(owner, 'GBP'), [
				{amount: '-10.00', bookingDate: '2026-09-04'},
			]);
			const [otherRow] = await createRows(await createBankAccount(otherOwner, 'GBP'), [
				{amount: '-10.00', bookingDate: '2026-09-04'},
			]);

			await service.backfill(NOW);

			expect(await stored(ownerRow.id)).toEqual(ecb('-12.50', '2026-09-04'));
			// -10 GBP / 0.8 * 1.25 = -15.625 USD.
			expect(await stored(otherRow.id)).toEqual(ecb('-15.63', '2026-09-04'));
		});

		it('leaves amounts unconverted while the owner has no reporting currency', async () => {
			const connection = await fixtures.createConnection(otherOwner);
			const [gbpAccount] = await fixtures.createBankAccounts(connection, [{currency: 'GBP'}, {currency: 'EUR'}]);
			const [row] = await createRows(gbpAccount, [{amount: '-10.00', bookingDate: '2026-09-04'}]);

			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 0, converted: 0});

			expect((await accounts.findOneByOrFail({id: otherOwner.id})).baseCurrency).toBeNull();
			expect(await stored(row.id)).toEqual(UNCONVERTED);
		});

		it("counts a row with the newest rate until its day's own is published, then converts it again", async () => {
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
			const [today, yesterday, saturday] = await createRows(await createBankAccount(owner, 'GBP'), [
				{amount: '-10.00', bookingDate: '2026-09-09'},
				{amount: '-10.00', bookingDate: '2026-09-08'},
				{amount: '-10.00', bookingDate: '2026-09-05'},
			]);
			publishedThrough = '2026-09-08';

			await expect(service.backfill(BEFORE_PUBLICATION)).resolves.toEqual({scanned: 3, converted: 3});
			expect(await stored(today.id)).toEqual(ecb('-12.50', '2026-09-08'));
			expect(await stored(yesterday.id)).toEqual(ecb('-12.50', '2026-09-08'));
			expect(await stored(saturday.id)).toEqual(ecb('-12.50', '2026-09-04'));

			// Until it is published, later runs neither download stored rates again nor rewrite the row.
			ecbRequests = [];
			await expect(service.backfill(BEFORE_PUBLICATION)).resolves.toEqual({scanned: 0, converted: 0});
			expect(ecbRequests).toEqual([]);

			// The day's own rate differs from the one that stood in; only that row changes.
			await fxRates.save({currency: 'GBP', rateDate: '2026-09-09', rateToEur: '0.5', provider: 'ECB'});
			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 1, converted: 1});
			expect(await stored(today.id)).toEqual(ecb('-20.00', '2026-09-09'));
			expect(await stored(yesterday.id)).toEqual(ecb('-12.50', '2026-09-08'));
			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 0, converted: 0});
		});

		it('counts a row with the newest stored rate while ECB is unavailable', async () => {
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
			const [row] = await createRows(await createBankAccount(owner, 'GBP'), [
				{amount: '-10.00', bookingDate: '2026-09-05'},
			]);
			await fxRates.save({currency: 'GBP', rateDate: '2026-09-03', rateToEur: '0.8', provider: 'ECB'});
			publishedThrough = null;

			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 1, converted: 1});
			expect(await stored(row.id)).toEqual(ecb('-12.50', '2026-09-03'));
		});

		it('corrects a row once either of its two rates is published, whichever came first', async () => {
			// GBP into USD for one owner and USD into GBP for the other: on the same day, Wednesday's GBP rate is out while
			// USD's still stands in with Tuesday's, so each owner has one final and one stand-in rate.
			await accounts.update({id: owner.id}, {baseCurrency: 'USD'});
			await accounts.update({id: otherOwner.id}, {baseCurrency: 'GBP'});
			const [gbpRow] = await createRows(await createBankAccount(owner, 'GBP'), [
				{amount: '-10.00', bookingDate: '2026-09-09'},
			]);
			const [usdRow] = await createRows(await createBankAccount(otherOwner, 'USD'), [
				{amount: '-10.00', bookingDate: '2026-09-09'},
			]);
			await fxRates.save([
				{currency: 'GBP', rateDate: '2026-09-09', rateToEur: '0.8', provider: 'ECB'},
				{currency: 'USD', rateDate: '2026-09-08', rateToEur: '1.25', provider: 'ECB'},
			]);
			publishedThrough = null;

			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 2, converted: 2});
			expect(await stored(gbpRow.id)).toEqual(ecb('-15.63', '2026-09-08'));
			expect(await stored(usdRow.id)).toEqual(ecb('-6.40', '2026-09-08'));
			await expect(service.backfill(NOW)).resolves.toMatchObject({converted: 0});

			await fxRates.save({currency: 'USD', rateDate: '2026-09-09', rateToEur: '1.5', provider: 'ECB'});
			await expect(service.backfill(NOW)).resolves.toMatchObject({converted: 2});
			expect(await stored(gbpRow.id)).toEqual(ecb('-18.75', '2026-09-09'));
			expect(await stored(usdRow.id)).toEqual(ecb('-5.33', '2026-09-09'));
			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 0, converted: 0});
		});

		it("corrects a stand-in once its day's rate is out, also for an account that is no longer active", async () => {
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
			const [row] = await createRows(await createBankAccount(owner, 'GBP', {isActive: false}), [
				{amount: '-10.00', bookingDate: '2026-09-09'},
			]);
			publishedThrough = '2026-09-08';
			await expect(service.backfill(BEFORE_PUBLICATION)).resolves.toMatchObject({converted: 1});
			expect(await stored(row.id)).toEqual(ecb('-12.50', '2026-09-08'));

			publishedThrough = '2026-09-09';
			await expect(service.backfill(NOW)).resolves.toMatchObject({converted: 1});
			expect(await stored(row.id)).toEqual(ecb('-12.50', '2026-09-09'));
		});

		it('uses the previous publication for an ECB holiday once a later one is out', async () => {
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
			const [holiday, unpublished] = await createRows(await createBankAccount(owner, 'GBP'), [
				{amount: '-10.00', bookingDate: '2026-09-03'},
				{amount: '-10.00', bookingDate: '2026-09-08'},
			]);
			// No publication on Thursday 2026-09-03 (a synthetic holiday) or yet on Tuesday 2026-09-08.
			await fxRates.save(
				['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-04', '2026-09-07'].map((rateDate) => ({
					currency: 'GBP',
					rateDate,
					rateToEur: rateDate === '2026-09-02' ? '0.5' : '0.8',
					provider: 'ECB',
				})),
			);
			publishedThrough = null;

			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 2, converted: 2});
			expect(await stored(holiday.id)).toEqual(ecb('-20.00', '2026-09-02'));
			// Tuesday's stands in with Monday's rate; the holiday row already has its final one and is not converted again.
			expect(await stored(unpublished.id)).toEqual(ecb('-12.50', '2026-09-07'));
			await fxRates.save({currency: 'GBP', rateDate: '2026-09-08', rateToEur: '0.8', provider: 'ECB'});
			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 1, converted: 1});
			expect(await stored(holiday.id)).toEqual(ecb('-20.00', '2026-09-02'));
		});

		it('does not fetch a range that is already stored without gaps', async () => {
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
			const [row] = await createRows(await createBankAccount(owner, 'GBP'), [
				{amount: '-10.00', bookingDate: '2026-09-01'},
			]);
			const weekdays = [
				...['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'],
				...['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'],
				...['2026-09-07', '2026-09-08', '2026-09-09'],
			];
			await fxRates.save(
				weekdays.map((rateDate) => ({currency: 'GBP', rateDate, rateToEur: '0.8', provider: 'ECB'})),
			);

			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 1, converted: 1});
			expect(ecbRequests).toEqual([]);
			expect(await stored(row.id)).toMatchObject({amountInBaseCurrency: '-12.50'});
		});

		it('converts a holiday row in a currency the rate refresh does not cover', async () => {
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
			const [row] = await createRows(await createBankAccount(owner, 'GBP', {isActive: false}), [
				{amount: '-10.00', bookingDate: '2026-09-03'},
			]);
			holidays = new Set(['2026-09-03']);

			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 1, converted: 1});
			expect(ecbRequests).toEqual([{currency: 'GBP', from: '2026-08-27', to: '2026-09-09'}]);
			expect(await stored(row.id)).toEqual(ecb('-12.50', '2026-09-02'));
		});

		it('fetches rates again when the stored history has a gap', async () => {
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
			const [row] = await createRows(await createBankAccount(owner, 'GBP'), [
				{amount: '-10.00', bookingDate: '2026-09-01'},
			]);
			await fxRates.save([
				{currency: 'GBP', rateDate: '2026-08-14', rateToEur: '0.5', provider: 'ECB'},
				{currency: 'GBP', rateDate: '2026-09-09', rateToEur: '0.8', provider: 'ECB'},
			]);

			await service.backfill(NOW);

			expect(ecbRequests).toEqual([{currency: 'GBP', from: '2026-08-25', to: '2026-09-08'}]);
			expect(await stored(row.id)).toEqual(ecb('-12.50', '2026-09-01'));
		});

		it('reconverts amounts stored without provenance', async () => {
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
			const [row] = await createRows(await createBankAccount(owner, 'GBP'), [
				{amount: '-10.00', bookingDate: '2026-09-04', amountInBaseCurrency: '-11.76'},
			]);

			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 1, converted: 1});
			expect(await stored(row.id)).toEqual(ecb('-12.50', '2026-09-04'));
		});

		it('leaves already converted rows untouched', async () => {
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
			const [row] = await createRows(await createBankAccount(owner, 'GBP'), [
				{
					amount: '-10.00',
					bookingDate: '2026-09-04',
					amountInBaseCurrency: '-11.00',
					baseAmountMethod: 'INSTRUCTED',
				},
			]);

			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 0, converted: 0});
			expect(await stored(row.id)).toEqual({
				amountInBaseCurrency: '-11.00',
				baseAmountMethod: 'INSTRUCTED',
				baseAmountRateDate: null,
			});
		});
	});

	describe('a change of reporting currency', () => {
		let agent: TestAgent;
		let persistence: BankTransactionPersistenceService;
		let dataSource: DataSource;

		beforeAll(async () => {
			agent = await loginAgent(app.getHttpServer(), VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
			persistence = app.get(BankTransactionPersistenceService);
			dataSource = app.get(DataSource);
		});

		async function storedAmounts(ids: string[]) {
			const rows = await fixtures.transactions.findBy({id: In(ids)});
			return ids.map((id) => {
				const {amountInBaseCurrency, baseAmountMethod, baseAmountRateDate} = rows.find((row) => row.id === id)!;
				return {amountInBaseCurrency, baseAmountMethod, baseAmountRateDate};
			});
		}

		/** Everything stored about the rows besides their converted amounts. */
		async function transactionsThemselves(ids: string[]) {
			const rows = await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}});
			return rows.map(
				({amountInBaseCurrency: _a, baseAmountMethod: _m, baseAmountRateDate: _d, updatedAt: _u, ...row}) =>
					row,
			);
		}

		async function readiness() {
			const {currency, recalculating} = (await agent.get('/reporting-currency').expect(200))
				.body as ReportingCurrency;
			const totals = (await agent.get('/bank-transactions/totals').expect(200)).body as BankTransactionTotals;
			return {currency, recalculating, totals};
		}

		async function eurOwnerWithHistory() {
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR', baseCurrencyState: 'CONFIRMED'});
			const eurAccount = await createBankAccount(owner, 'EUR');
			const gbpAccount = await createBankAccount(owner, 'GBP');
			const categorized = {category: 'SHOPPING', categoryStatus: 'COMPLETED', categorySource: 'MANUAL'} as const;
			const [eurDebit] = await createRows(eurAccount, [
				{amount: '-10.00', bookingDate: '2026-09-04', ...categorized},
			]);
			const [gbpDebit, gbpCredit, chfDebit] = await createRows(gbpAccount, [
				{amount: '-10.00', bookingDate: '2026-09-04', ...categorized},
				{amount: '20.00', creditDebitIndicator: 'CRDT', bookingDate: '2026-09-04'},
				{amount: '-5.00', currency: 'CHF', bookingDate: '2026-09-04'},
			]);
			await service.backfill(NOW);
			return {eurAccount, gbpAccount, ids: [eurDebit.id, gbpDebit.id, gbpCredit.id, chfDebit.id]};
		}

		it('converts every amount again into the new currency while the transactions stay as they are', async () => {
			const {ids} = await eurOwnerWithHistory();
			expect(await readiness()).toMatchObject({
				currency: 'EUR',
				recalculating: false,
				totals: {baseCurrency: 'EUR', spending: '22.50', income: '25.00', excluded: {missingBaseAmount: 1}},
			});
			const transactions = await transactionsThemselves(ids);
			ecbRequests = [];

			// USD is no account's currency; its rates are fetched for the history anyway.
			await agent.put('/reporting-currency').send({currency: 'USD'}).expect(200);

			// No figure is labelled USD before the amounts are in USD, and no EUR amount is left to be read as USD.
			expect(await readiness()).toMatchObject({
				currency: 'USD',
				recalculating: true,
				totals: {baseCurrency: null},
			});
			expect(await storedAmounts(ids)).toEqual([UNCONVERTED, UNCONVERTED, UNCONVERTED, UNCONVERTED]);

			await service.backfill(NOW);

			expect(ecbRequests).toContainEqual(expect.objectContaining({currency: 'USD'}));
			// -10 EUR * 1.25; -10 GBP / 0.8 * 1.25 = -15.625; 20 GBP / 0.8 * 1.25; CHF has no rate.
			expect(await storedAmounts(ids)).toEqual([
				ecb('-12.50', '2026-09-04'),
				ecb('-15.63', '2026-09-04'),
				ecb('31.25', '2026-09-04'),
				UNCONVERTED,
			]);
			expect(await readiness()).toMatchObject({
				currency: 'USD',
				recalculating: false,
				totals: {baseCurrency: 'USD', spending: '28.13', income: '31.25', excluded: {missingBaseAmount: 1}},
			});
			expect(await transactionsThemselves(ids)).toEqual(transactions);

			// Choosing it again changes nothing.
			await agent.put('/reporting-currency').send({currency: 'USD'}).expect(200);
			expect(await readiness()).toMatchObject({currency: 'USD', recalculating: false});
			expect((await storedAmounts(ids))[0]).toEqual(ecb('-12.50', '2026-09-04'));
		});

		it('finishes a change after one pass even while ECB is unavailable, and converts the rest once it is back', async () => {
			const {ids} = await eurOwnerWithHistory();
			await fxRates.clear();
			publishedThrough = null;

			await agent.put('/reporting-currency').send({currency: 'GBP'}).expect(200);
			await service.backfill(NOW);

			// Rows already in GBP were copied; the others are reported as left out of the totals, not waited for.
			expect(await readiness()).toMatchObject({
				currency: 'GBP',
				recalculating: false,
				totals: {baseCurrency: 'GBP', spending: '10.00', income: '20.00', excluded: {missingBaseAmount: 2}},
			});

			publishedThrough = '2026-09-09';
			await service.backfill(NOW);

			expect(await storedAmounts(ids)).toEqual([
				ecb('-8.00', '2026-09-04'),
				same('-10.00'),
				same('20.00'),
				UNCONVERTED,
			]);
		});

		it('keeps a sync write that races a change from leaving amounts in the old currency', async () => {
			const {gbpAccount} = await eurOwnerWithHistory();
			let commitSync!: () => void;
			const syncHolds = new Promise<void>((resolve) => (commitSync = resolve));
			let written!: () => void;
			const rowWritten = new Promise<void>((resolve) => (written = resolve));
			// As a sync's write does: the lock first, then rows, some of them in the reporting currency (EUR).
			const sync = dataSource.transaction(async (manager) => {
				await lockReportingCurrencyForAmountWrites(manager, owner.id);
				await persistence.persistTransactions(
					manager.getRepository(BankTransaction),
					gbpAccount,
					[
						{
							amount: '7.00',
							currency: 'EUR',
							creditDebitIndicator: 'CRDT',
							bookingDate: '2026-09-07',
							status: 'BOOK',
						},
					],
					'Example Bank',
					'enable_banking',
				);
				written();
				await syncHolds;
			});
			await rowWritten;

			let changed = false;
			const change = agent
				.put('/reporting-currency')
				.send({currency: 'GBP'})
				.expect(200)
				.then(() => (changed = true));
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(changed).toBe(false);
			commitSync();
			await Promise.all([sync, change]);

			const synced = await fixtures.transactions.findOneByOrFail({bankAccountId: gbpAccount.id, amount: '7.00'});
			expect(await storedAmounts([synced.id])).toEqual([UNCONVERTED]);
		});

		it('discards a conversion pass that started before a change', async () => {
			const {ids} = await eurOwnerWithHistory();
			await fixtures.transactions.update({id: In(ids)}, {amountInBaseCurrency: null, baseAmountMethod: null});
			// The pass waits on ECB while the owner switches to GBP.
			let answerEcb!: () => void;
			const ecbAnswered = new Promise<void>((resolve) => (answerEcb = resolve));
			let asked!: () => void;
			const ecbAsked = new Promise<void>((resolve) => (asked = resolve));
			const respond = fetchSpy.getMockImplementation()!;
			// Only the history fetch, which comes after the pass read the owner's currency.
			fetchSpy.mockImplementation(async (input: string) => {
				if (new URL(input).searchParams.get('startPeriod')! < '2026-09-01') {
					asked();
					await ecbAnswered;
				}
				return respond(input);
			});
			await fxRates.clear();

			const pass = service.backfill(NOW);
			await ecbAsked;
			await agent.put('/reporting-currency').send({currency: 'GBP'}).expect(200);
			answerEcb();
			await pass;

			// Nothing in EUR came back: only the rows copied by the change itself hold amounts.
			expect(await storedAmounts(ids)).toEqual([UNCONVERTED, same('-10.00'), same('20.00'), UNCONVERTED]);
			expect(await readiness()).toMatchObject({currency: 'GBP', recalculating: true});

			await service.backfill(NOW);
			expect(await readiness()).toMatchObject({currency: 'GBP', recalculating: false});
			expect((await storedAmounts(ids))[0]).toEqual(ecb('-8.00', '2026-09-04'));
		});
	});
});

function syntheticEcbCsv(currency: string, from: string, to: string, holidays: ReadonlySet<string>): string {
	const rows = ['KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE'];
	const rate = SYNTHETIC_RATES[currency];
	for (let date = new Date(`${from}T00:00:00.000Z`); date <= new Date(`${to}T00:00:00.000Z`);) {
		const weekday = date.getUTCDay();
		if (rate && weekday !== 0 && weekday !== 6 && !holidays.has(date.toISOString().slice(0, 10))) {
			rows.push(
				`EXR.D.${currency}.EUR.SP00.A,D,${currency},EUR,SP00,A,${date.toISOString().slice(0, 10)},${rate}`,
			);
		}
		date.setUTCDate(date.getUTCDate() + 1);
	}
	return `${rows.join('\n')}\n`;
}
