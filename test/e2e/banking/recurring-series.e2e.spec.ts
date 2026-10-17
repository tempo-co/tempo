import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import TestAgent from 'supertest/lib/agent';
import {In, Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';
import {BankAccount} from '@modules/banking/bank-account.entity';

import {BankingFixtures, CURRENCY_EXCHANGE_EVENT, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {
	SESSION_TEST_ACCOUNT_EMAIL,
	SESSION_TEST_ACCOUNT_PASSWORD,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';

const AS_OF = '2026-10-17';
const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

type SeriesBody = {
	key: string;
	name: string;
	cadence: string;
	amountKind: string;
	currency: string;
	typicalAmount: string;
	monthlyEquivalent: string | null;
	transactionCount: number;
	nextExpectedDate: string;
	status: string;
	flags: string[];
	decision: string | null;
};

function monthly(day: string, amount: string, counterpartyName: string, overrides: Record<string, unknown> = {}) {
	return MONTHS.map((month) =>
		bookedRow(`${month}-${day}`, amount, {counterpartyName, description: counterpartyName, ...overrides}),
	);
}

describe('RecurringSeries', () => {
	let app: INestApplication;
	let fixtures: BankingFixtures;
	let owner: Account;
	let otherOwner: Account;
	let ownerAgent: TestAgent;
	let otherAgent: TestAgent;
	let ownerBankAccount: BankAccount;

	const list = async (agent: TestAgent, direction = 'EXPENSE') =>
		(await agent.get('/recurring-series').query({asOf: AS_OF, direction}).expect(200)).body as {
			series: SeriesBody[];
			confirmedMonthlyTotal: string;
			unconvertedConfirmedCount: number;
			baseCurrency: string | null;
		};
	const byName = (series: SeriesBody[], name: string) => series.filter((entry) => entry.name === name);

	beforeAll(async () => {
		app = getApp();
		fixtures = new BankingFixtures(app);
		const accounts: Repository<Account> = app.get(getRepositoryToken(Account));
		const accountService = app.get(AccountService);
		owner = (await accountService.findByEmail(VERIFIED_ACCOUNT_EMAIL))!;
		otherOwner = (await accountService.findByEmail(SESSION_TEST_ACCOUNT_EMAIL))!;
		ownerAgent = await loginAgent(app.getHttpServer(), VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		otherAgent = await loginAgent(app.getHttpServer(), SESSION_TEST_ACCOUNT_EMAIL, SESSION_TEST_ACCOUNT_PASSWORD);
		await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});

		ownerBankAccount = await fixtures.createBankAccount(await fixtures.createConnection(owner));
		const ownerGbpAccount = await fixtures.createBankAccount(await fixtures.createConnection(owner), {
			currency: 'GBP',
		});
		const otherBankAccount = await fixtures.createBankAccount(await fixtures.createConnection(otherOwner));

		await fixtures.createTransactions(ownerBankAccount, [
			...monthly('03', '-29.99', 'Example Gym', {category: 'SUBSCRIPTIONS'}),
			// Price step on the last payment.
			...monthly('08', '-10.00', 'Example Streaming').slice(0, 5),
			bookedRow('2026-10-08', '-11.50', {
				counterpartyName: 'Example Streaming',
				description: 'Example Streaming',
			}),
			// Overdue: no October payment.
			...monthly('01', '-45.00', 'Example Phone').slice(0, 5),
			// Ended in June.
			...monthly('02', '-15.00', 'Example Magazine').slice(0, 2),
			bookedRow('2026-04-02', '-15.00', {counterpartyName: 'Example Magazine', description: 'Example Magazine'}),
			bookedRow('2025-09-12', '-120.00', {counterpartyName: 'Example Insurer', description: 'Example Insurer'}),
			bookedRow('2026-09-14', '-120.00', {counterpartyName: 'Example Insurer', description: 'Example Insurer'}),
			// Irregular purchases at one shop.
			...['2026-06-02', '2026-06-20', '2026-07-30', '2026-08-04', '2026-09-27', '2026-10-01'].map((date) =>
				bookedRow(date, '-15.00', {counterpartyName: 'Example Shop', description: 'Example Shop'}),
			),
			// Monthly own transfers, currency exchanges, refunds and pending rows are never recurring payments.
			...monthly('10', '-200.00', 'Example Savings', {ownTransferEvidence: 'IBAN', category: 'TRANSFER_OUT'}),
			...monthly('11', '-50.00', 'Example Exchange', {
				category: null,
				categoryStatus: 'NOT_APPLICABLE',
				...CURRENCY_EXCHANGE_EVENT,
			}),
			...monthly('12', '5.00', 'Example Refunder', {category: 'REFUND'}),
			...monthly('13', '-7.00', 'Example Pending', {transactionStatus: 'PDNG'}),
			...monthly('25', '2500.00', 'Example Employer', {category: 'INCOME'}),
			// A bank that marks settled payments COMPLETED, then switches format: the person's name moves from the
			// description to the counterparty, with accents and without a middle name.
			...MONTHS.slice(0, 4).map((month) =>
				bookedRow(`${month}-27`, '-650.00', {
					transactionStatus: 'COMPLETED',
					counterpartyName: null,
					description: 'Transfer to ALEX-SAM EXAMPLE',
					category: 'HOUSING_AND_UTILITIES',
				}),
			),
			bookedRow('2026-09-27', '-650.00', {
				counterpartyName: 'Alex Exämple',
				description: 'rent',
				category: 'HOUSING_AND_UTILITIES',
			}),
		]);
		await fixtures.createTransactions(ownerGbpAccount, [
			...monthly('03', '-29.99', 'Example Gym', {currency: 'GBP', amountInBaseCurrency: '-34.50'}),
		]);
		await fixtures.createTransactions(otherBankAccount, monthly('04', '-60.00', 'Example Club'));
	});

	it('lists recurring payments with cadence, amounts and flags', async () => {
		const {series, baseCurrency} = await list(ownerAgent);

		expect(baseCurrency).toBe('EUR');
		expect(byName(series, 'Example Gym')).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					cadence: 'MONTHLY',
					amountKind: 'FIXED',
					currency: 'EUR',
					typicalAmount: '29.99',
					monthlyEquivalent: '29.99',
					transactionCount: 6,
					nextExpectedDate: '2026-11-03',
					status: 'ACTIVE',
					flags: [],
					decision: null,
				}),
				// The same shop in another currency is its own series, costed in the base currency.
				expect.objectContaining({currency: 'GBP', typicalAmount: '29.99', monthlyEquivalent: '34.50'}),
			]),
		);
		expect(byName(series, 'Example Streaming')).toEqual([
			expect.objectContaining({typicalAmount: '10.00', monthlyEquivalent: '11.50', flags: ['PRICE_INCREASED']}),
		]);
		expect(byName(series, 'Example Phone')).toEqual([
			expect.objectContaining({status: 'ACTIVE', flags: ['OVERDUE']}),
		]);
		expect(byName(series, 'Example Magazine')).toEqual([expect.objectContaining({status: 'ENDED'})]);
		expect(byName(series, 'Example Insurer')).toEqual([
			expect.objectContaining({cadence: 'YEARLY', monthlyEquivalent: '10.00', decision: null}),
		]);
	});

	it('finds rent across a settled status and a change in how the bank names the payee', async () => {
		const rent = (await list(ownerAgent)).series.filter(({typicalAmount}) => typicalAmount === '650.00');

		expect(rent).toEqual([
			expect.objectContaining({
				cadence: 'MONTHLY',
				transactionCount: 5,
				nextExpectedDate: '2026-10-27',
				status: 'ACTIVE',
			}),
		]);
	});

	it('leaves out irregular, internal, refunded and pending payments, income and other owners', async () => {
		const names = (await list(ownerAgent)).series.map(({name}) => name);

		for (const excluded of [
			'Example Shop',
			'Example Savings',
			'Example Exchange',
			'Example Refunder',
			'Example Pending',
			'Example Employer',
			'Example Club',
		]) {
			expect(names).not.toContain(excluded);
		}
		expect((await list(otherAgent)).series.map(({name}) => name)).toEqual(['Example Club']);
	});

	it('lists recurring income separately', async () => {
		expect((await list(ownerAgent, 'INCOME')).series).toEqual([
			expect.objectContaining({name: 'Example Employer', cadence: 'MONTHLY', typicalAmount: '2500.00'}),
		]);
	});

	it('confirms and dismisses series without touching their transactions', async () => {
		const before = await list(ownerAgent);
		const gym = before.series.find((entry) => entry.name === 'Example Gym' && entry.currency === 'EUR')!;
		const streaming = byName(before.series, 'Example Streaming')[0];
		const gymRows = await fixtures.transactions.find({
			where: {bankAccountId: ownerBankAccount.id, counterpartyName: In(['Example Gym', 'Example Streaming'])},
			order: {id: 'ASC'},
		});
		const snapshot = gymRows.map(({id, category, categorySource, merchantKey, updatedAt}) => ({
			id,
			category,
			categorySource,
			merchantKey,
			updatedAt,
		}));

		await ownerAgent.patch(`/recurring-series/${gym.key}/decision`).send({decision: 'CONFIRMED'}).expect(204);
		await ownerAgent.patch(`/recurring-series/${streaming.key}/decision`).send({decision: 'DISMISSED'}).expect(204);

		const after = await list(ownerAgent);
		expect(after.series[0]).toMatchObject({key: gym.key, decision: 'CONFIRMED'});
		expect(after.series.at(-1)).toMatchObject({key: streaming.key, decision: 'DISMISSED'});
		expect(after).toMatchObject({confirmedMonthlyTotal: '29.99', unconvertedConfirmedCount: 0});

		const rowsAfter = await fixtures.transactions.find({
			where: {id: In(snapshot.map(({id}) => id))},
			order: {id: 'ASC'},
		});
		expect(
			rowsAfter.map(({id, category, categorySource, merchantKey, updatedAt}) => ({
				id,
				category,
				categorySource,
				merchantKey,
				updatedAt,
			})),
		).toEqual(snapshot);
	});

	it('keeps a dismissed series dismissed when new payments arrive, until the owner undoes it', async () => {
		const streaming = byName((await list(ownerAgent)).series, 'Example Streaming')[0];
		await ownerAgent.patch(`/recurring-series/${streaming.key}/decision`).send({decision: 'DISMISSED'}).expect(204);

		await fixtures.createTransaction(
			ownerBankAccount,
			bookedRow('2026-10-16', '-11.50', {
				counterpartyName: 'Example Streaming',
				description: 'Example Streaming',
			}),
		);
		const [stillDismissed] = byName((await list(ownerAgent)).series, 'Example Streaming');
		expect(stillDismissed).toMatchObject({key: streaming.key, decision: 'DISMISSED', transactionCount: 7});

		await ownerAgent.patch(`/recurring-series/${streaming.key}/decision`).send({decision: null}).expect(204);
		expect(byName((await list(ownerAgent)).series, 'Example Streaming')[0].decision).toBeNull();
	});

	it('keeps a decision when a series is reclassified', async () => {
		const utility = {counterpartyName: 'Example Utility', description: 'Example Utility'};
		await fixtures.createTransactions(ownerBankAccount, [
			bookedRow('2026-06-20', '-10.00', utility),
			bookedRow('2026-07-20', '-20.00', utility),
			bookedRow('2026-08-20', '-20.00', utility),
		]);
		const [variable] = byName((await list(ownerAgent)).series, 'Example Utility');
		expect(variable).toMatchObject({amountKind: 'VARIABLE', transactionCount: 3});
		await ownerAgent.patch(`/recurring-series/${variable.key}/decision`).send({decision: 'CONFIRMED'}).expect(204);

		// The amount settles, so the series becomes a fixed one starting at another payment.
		await fixtures.createTransaction(ownerBankAccount, bookedRow('2026-09-20', '-20.00', utility));
		const [fixed] = byName((await list(ownerAgent)).series, 'Example Utility');
		expect(fixed).toMatchObject({amountKind: 'FIXED', decision: 'CONFIRMED'});
		expect(fixed.key).not.toBe(variable.key);

		// Undoing under the new key clears the inherited decision too.
		await ownerAgent.patch(`/recurring-series/${fixed.key}/decision`).send({decision: null}).expect(204);
		expect(byName((await list(ownerAgent)).series, 'Example Utility')[0].decision).toBeNull();
	});

	it('gives a split series’ decision to one part only, so changing one leaves the other alone', async () => {
		const water = {counterpartyName: 'Example Water', description: 'Example Water'};
		await fixtures.createTransactions(ownerBankAccount, [
			bookedRow('2026-05-21', '-10.00', water),
			bookedRow('2026-06-21', '-20.00', water),
			bookedRow('2026-07-21', '-20.00', water),
		]);
		const [variable] = byName((await list(ownerAgent)).series, 'Example Water');
		expect(variable).toMatchObject({amountKind: 'VARIABLE'});
		await ownerAgent.patch(`/recurring-series/${variable.key}/decision`).send({decision: 'CONFIRMED'}).expect(204);

		// Two plans billed side by side split it into two fixed series.
		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-08-21', '2026-09-21', '2026-10-16'].flatMap((date) => [
				bookedRow(date, '-10.00', water),
				bookedRow(date, '-20.00', water),
			]),
		);
		const parts = byName((await list(ownerAgent)).series, 'Example Water');
		expect(parts).toHaveLength(2);
		const confirmed = parts.filter(({decision}) => decision === 'CONFIRMED');
		expect(confirmed).toHaveLength(1);
		const other = parts.find(({key}) => key !== confirmed[0].key)!;

		await ownerAgent.patch(`/recurring-series/${other.key}/decision`).send({decision: 'DISMISSED'}).expect(204);
		await ownerAgent.patch(`/recurring-series/${other.key}/decision`).send({decision: null}).expect(204);
		const after = byName((await list(ownerAgent)).series, 'Example Water');
		expect(after.find(({key}) => key === confirmed[0].key)?.decision).toBe('CONFIRMED');
		expect(after.find(({key}) => key === other.key)?.decision).toBeNull();
	});

	it('resets a merged series fully, whatever its parts were decided as', async () => {
		const internet = {counterpartyName: 'Example Internet', description: 'Example Internet'};
		await fixtures.createTransactions(ownerBankAccount, [
			...['2026-01-22', '2026-02-22', '2026-03-22'].map((date) => bookedRow(date, '-10.00', internet)),
			...['2026-04-22', '2026-05-22', '2026-06-22'].map((date) => bookedRow(date, '-20.00', internet)),
		]);
		const parts = byName((await list(ownerAgent)).series, 'Example Internet');
		expect(parts).toHaveLength(2);
		const [cheap, dear] = [...parts].sort((x, y) => Number(x.typicalAmount) - Number(y.typicalAmount));
		await ownerAgent.patch(`/recurring-series/${cheap.key}/decision`).send({decision: 'CONFIRMED'}).expect(204);
		await ownerAgent.patch(`/recurring-series/${dear.key}/decision`).send({decision: 'DISMISSED'}).expect(204);

		// Rising amounts merge both into one variable series.
		await fixtures.createTransactions(ownerBankAccount, [
			bookedRow('2026-07-22', '-30.00', internet),
			bookedRow('2026-08-22', '-40.00', internet),
			bookedRow('2026-09-22', '-50.00', internet),
		]);
		const [merged] = byName((await list(ownerAgent)).series, 'Example Internet');
		expect(merged).toMatchObject({amountKind: 'VARIABLE', transactionCount: 9});
		expect(merged.decision).not.toBeNull();

		await ownerAgent.patch(`/recurring-series/${merged.key}/decision`).send({decision: null}).expect(204);
		expect(byName((await list(ownerAgent)).series, 'Example Internet')[0].decision).toBeNull();
	});

	it('does not move a reset decision to the other part of a split', async () => {
		const supplier = {counterpartyName: 'Example Supplier', description: 'Example Supplier'};
		await fixtures.createTransactions(ownerBankAccount, [
			bookedRow('2026-05-17', '-30.00', supplier),
			bookedRow('2026-06-17', '-10.00', supplier),
			bookedRow('2026-07-17', '-20.00', supplier),
		]);
		const [variable] = byName((await list(ownerAgent)).series, 'Example Supplier');
		expect(variable.amountKind).toBe('VARIABLE');
		await ownerAgent.patch(`/recurring-series/${variable.key}/decision`).send({decision: 'CONFIRMED'}).expect(204);

		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-08-17', '2026-09-17', '2026-10-17'].flatMap((date) => [
				bookedRow(date, '-10.00', supplier),
				bookedRow(date, '-20.00', supplier),
			]),
		);
		const parts = byName((await list(ownerAgent)).series, 'Example Supplier');
		expect(parts).toHaveLength(2);
		expect(parts.every(({key}) => key !== variable.key)).toBe(true);
		const confirmed = parts.filter(({decision}) => decision === 'CONFIRMED');
		expect(confirmed).toHaveLength(1);
		await ownerAgent.patch(`/recurring-series/${confirmed[0].key}/decision`).send({decision: null}).expect(204);
		const reset = byName((await list(ownerAgent)).series, 'Example Supplier');
		expect(reset.map(({decision}) => decision)).toEqual([null, null]);
	});

	it('rejects keys that are invalid, unknown or another owner’s', async () => {
		const [club] = (await list(otherAgent)).series;

		await ownerAgent.patch(`/recurring-series/${club.key}/decision`).send({decision: 'CONFIRMED'}).expect(404);
		await ownerAgent.patch(`/recurring-series/${club.key}/decision`).send({decision: null}).expect(404);
		await ownerAgent
			.patch(`/recurring-series/${'0'.repeat(32)}/decision`)
			.send({decision: 'CONFIRMED'})
			.expect(404);
		await ownerAgent.patch('/recurring-series/not-a-key/decision').send({decision: 'CONFIRMED'}).expect(400);
		await otherAgent.patch(`/recurring-series/${club.key}/decision`).send({decision: 'MAYBE'}).expect(400);
		await ownerAgent.get('/recurring-series').query({asOf: AS_OF, direction: 'UNKNOWN'}).expect(400);
		await ownerAgent.get('/recurring-series').expect(400);
		await ownerAgent
			.get('/bank-transactions')
			.query({filter: {recurringSeriesKey: club.key}})
			.expect(404);
	});

	it('drills through to exactly the series payments', async () => {
		const gym = (await list(ownerAgent)).series.find(
			(entry) => entry.name === 'Example Gym' && entry.currency === 'EUR',
		)!;

		const response = await ownerAgent
			.get('/bank-transactions')
			.query({filter: {recurringSeriesKey: gym.key}, pagination: {pageIndex: 0, pageSize: 50}})
			.expect(200);

		expect(response.body.total).toBe(gym.transactionCount);
		expect(
			response.body.transactions.every(
				(row: {counterpartyName: string; currency: string}) =>
					row.counterpartyName === 'Example Gym' && row.currency === 'EUR',
			),
		).toBe(true);
	});
});
