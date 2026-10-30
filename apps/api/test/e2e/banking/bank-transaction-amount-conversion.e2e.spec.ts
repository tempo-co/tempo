import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {DeepPartial, Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankTransactionFxRate} from '@modules/banking/bank-transaction-fx-rate.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {BankTransactionAmountConversionService} from '@modules/banking/services/bank-transaction-amount-conversion.service';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {SESSION_TEST_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_EMAIL} from '../../../scripts/seed-data/seed.constants';
import {getApp} from '../../setup/e2e.setup';

// Synthetic reference rates (units of currency per 1 EUR).
const SYNTHETIC_RATES: Readonly<Record<string, string>> = {GBP: '0.800000', USD: '1.250000', RON: '5.000000'};
// Wednesday 2026-09-09, 17:00 in Berlin: that day's ECB rates should already be published.
const NOW = new Date('2026-09-09T15:00:00.000Z');
// The same Wednesday at 10:00 in Berlin, before that day's publication.
const BEFORE_PUBLICATION = new Date('2026-09-09T08:00:00.000Z');

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
		await accounts.createQueryBuilder().update().set({baseCurrency: null}).execute();
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

		it('picks the most common active account currency as the base when none is set', async () => {
			const connection = await fixtures.createConnection(otherOwner);
			const [gbpAccount] = await fixtures.createBankAccounts(connection, [
				{currency: 'GBP'},
				{currency: 'GBP'},
				{currency: 'EUR'},
			]);
			const [row] = await createRows(gbpAccount, [{amount: '-10.004', bookingDate: '2026-09-04'}]);

			await service.backfill(NOW);

			expect((await accounts.findOneByOrFail({id: otherOwner.id})).baseCurrency).toBe('GBP');
			expect(await stored(row.id)).toEqual(same('-10.00'));
		});

		it("waits for the transaction day's own rate while it is not yet published", async () => {
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
			const [today, yesterday, saturday] = await createRows(await createBankAccount(owner, 'GBP'), [
				{amount: '-10.00', bookingDate: '2026-09-09'},
				{amount: '-10.00', bookingDate: '2026-09-08'},
				{amount: '-10.00', bookingDate: '2026-09-05'},
			]);
			publishedThrough = '2026-09-08';

			await expect(service.backfill(BEFORE_PUBLICATION)).resolves.toEqual({scanned: 3, converted: 2});
			expect(await stored(today.id)).toEqual(UNCONVERTED);
			expect(await stored(yesterday.id)).toMatchObject({baseAmountRateDate: '2026-09-08'});
			expect(await stored(saturday.id)).toMatchObject({baseAmountRateDate: '2026-09-04'});

			// Waiting rows do not re-download stored rates on every run.
			ecbRequests = [];
			await expect(service.backfill(BEFORE_PUBLICATION)).resolves.toEqual({scanned: 1, converted: 0});
			expect(ecbRequests).toEqual([]);

			publishedThrough = '2026-09-09';
			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 1, converted: 1});
			expect(await stored(today.id)).toEqual(ecb('-12.50', '2026-09-09'));
		});

		it('does not fall back to an older rate while ECB is unavailable', async () => {
			await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
			const [row] = await createRows(await createBankAccount(owner, 'GBP'), [
				{amount: '-10.00', bookingDate: '2026-09-05'},
			]);
			await fxRates.save({currency: 'GBP', rateDate: '2026-09-03', rateToEur: '0.8', provider: 'ECB'});
			publishedThrough = null;

			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 1, converted: 0});
			expect(await stored(row.id)).toEqual(UNCONVERTED);
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

			await expect(service.backfill(NOW)).resolves.toEqual({scanned: 2, converted: 1});
			expect(await stored(holiday.id)).toEqual(ecb('-20.00', '2026-09-02'));
			expect(await stored(unpublished.id)).toMatchObject({amountInBaseCurrency: null});
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
