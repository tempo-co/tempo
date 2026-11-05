import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import TestAgent from 'supertest/lib/agent';
import type {DeepPartial} from 'typeorm';
import {Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {Account} from '@modules/account/account.entity';
import {
	BANKING_TRANSACTION_BREAKDOWN_RANGE,
	BANKING_TRANSACTION_EVENTS_RANGE,
} from '@modules/banking/api/constants/banking-messages.constants';
import type {BankTransaction} from '@modules/banking/bank-transaction.entity';

import {BankingFixtures, CURRENCY_EXCHANGE_EVENT, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createVerifiedAccount} from '../../utils/auth-utils';

const BREAKDOWN = '/bank-transactions/breakdown';
const CASH_FLOW = '/bank-transactions/cash-flow';
const EVENTS = '/bank-transactions/events';

/** A row from a named merchant; the display name and merchant key follow the name. */
const named = (date: string, amount: string, name: string, overrides: DeepPartial<BankTransaction> = {}) =>
	bookedRow(date, amount, {
		description: name,
		displayDescription: name,
		merchantKey: `${amount.startsWith('-') ? 'EXPENSE' : 'INCOME'}:${name.toLowerCase()}`,
		...overrides,
	});

const months = (from: string, to: string) => {
	const out: string[] = [];
	for (let date = new Date(`${from}-01T00:00:00Z`); date.toISOString().slice(0, 7) <= to;) {
		out.push(date.toISOString().slice(0, 7));
		date.setUTCMonth(date.getUTCMonth() + 1);
	}
	return out;
};

describe('Bank transaction history', () => {
	let app: INestApplication;
	let fixtures: BankingFixtures;
	let accounts: Repository<Account>;

	async function verifiedOwner() {
		const fresh = await createVerifiedAccount(
			app.getHttpServer(),
			app.get(ConfigurationService).get('EMAIL_UI_URL'),
		);
		await accounts.update({id: fresh.id}, {baseCurrency: 'EUR'});
		const bankAccount = await fixtures.createBankAccount(await fixtures.createConnection({id: fresh.id}));
		return {...fresh, bankAccount};
	}

	beforeAll(() => {
		app = getApp();
		fixtures = new BankingFixtures(app);
		accounts = app.get(getRepositoryToken(Account));
	});

	describe('breakdown', () => {
		let agent: TestAgent;
		let otherAgent: TestAgent;
		const ASOF = '2026-03-10';

		beforeAll(async () => {
			const owner = await verifiedOwner();
			const other = await verifiedOwner();
			agent = owner.agent;
			otherAgent = other.agent;
			const employer = {merchantKey: 'INCOME:example employer'};
			await fixtures.createTransactions(owner.bankAccount, [
				// History starts on 15 November.
				named('2025-11-15', '-50.00', 'Corner Shop', {category: 'FOOD_AND_DRINK'}),
				named('2025-11-20', '1000.00', 'Example Employer', {category: 'INCOME', ...employer}),
				named('2025-12-05', '-30.00', 'Corner Shop', {category: 'FOOD_AND_DRINK'}),
				named('2025-12-10', '-200.00', 'Example Store', {category: 'SHOPPING'}),
				named('2025-12-12', '40.00', 'Example Store', {category: 'REFUND'}),
				named('2025-12-20', '1000.00', 'EXAMPLE EMPLOYER PAYROLL', {category: 'INCOME', ...employer}),
				// No merchant key: the source falls back to the display name.
				named('2025-12-22', '25.00', 'Market Stall', {category: null, merchantKey: null}),
				named('2026-01-08', '-80.00', 'Unknown Place', {category: null}),
				named('2026-01-20', '1000.00', 'Example Employer', {category: 'INCOME', ...employer}),
				// Left out: an own transfer, a currency exchange and a row without a base amount.
				named('2026-01-09', '-500.00', 'Own Savings', {category: null, ownTransferEvidence: 'IBAN'}),
				named('2026-01-09', '500.00', 'Own Savings', {category: null, ownTransferEvidence: 'IBAN'}),
				named('2026-01-10', '-300.00', 'Exchange', {
					category: null,
					categoryStatus: 'NOT_APPLICABLE',
					...CURRENCY_EXCHANGE_EVENT,
				}),
				named('2026-01-11', '-999.00', 'Foreign Shop', {category: 'SHOPPING', amountInBaseCurrency: null}),
				named('2026-02-03', '60.00', 'Example Store', {category: 'REFUND'}),
				named('2026-02-04', '-10.00', 'Corner Shop', {category: 'FOOD_AND_DRINK'}),
				named('2026-03-02', '-20.00', 'Corner Shop', {category: 'FOOD_AND_DRINK'}),
			]);
			await fixtures.createTransactions(other.bankAccount, [
				named('2026-01-05', '-7777.00', 'Corner Shop', {category: 'FOOD_AND_DRINK'}),
				named('2026-01-06', '5555.00', 'Example Employer', {category: 'INCOME', ...employer}),
			]);
		});

		it('splits each month’s spending by category, net of refunds, with cash flow’s totals', async () => {
			const query = {interval: 'month', from: '2025-10-01', to: ASOF, asOf: ASOF};
			const [{body}, {body: flow}] = await Promise.all([
				agent
					.get(BREAKDOWN)
					.query({...query, by: 'category'})
					.expect(200),
				agent.get(CASH_FLOW).query(query).expect(200),
			]);

			const part = (key: string, amount: string) => ({key, label: key, amount});
			expect(body).toEqual({
				baseCurrency: 'EUR',
				interval: 'month',
				by: 'category',
				periods: [
					// October is before the history; November starts inside it, so it is partial.
					{
						start: '2025-11-01',
						end: '2025-11-30',
						complete: false,
						total: '50.00',
						parts: [part('FOOD_AND_DRINK', '50.00')],
					},
					{
						start: '2025-12-01',
						end: '2025-12-31',
						complete: true,
						total: '190.00',
						parts: [part('SHOPPING', '200.00'), part('FOOD_AND_DRINK', '30.00'), part('REFUND', '-40.00')],
					},
					{
						start: '2026-01-01',
						end: '2026-01-31',
						complete: true,
						total: '80.00',
						parts: [part('UNCATEGORIZED', '80.00')],
					},
					{
						start: '2026-02-01',
						end: '2026-02-28',
						complete: true,
						total: '-50.00',
						parts: [part('FOOD_AND_DRINK', '10.00'), part('REFUND', '-60.00')],
					},
					{
						start: '2026-03-01',
						end: ASOF,
						complete: false,
						total: '20.00',
						parts: [part('FOOD_AND_DRINK', '20.00')],
					},
				],
			});
			expect(body.periods.map(({start, total}: {start: string; total: string}) => [start, total])).toEqual(
				flow.periods.map(({start, spending}: {start: string; spending: string}) => [start, spending]),
			);
		});

		it('splits each year’s income by source, labelled by its most common name', async () => {
			const query = {interval: 'year', from: '2025-01-01', to: ASOF, asOf: ASOF};
			const [{body}, {body: flow}] = await Promise.all([
				agent
					.get(BREAKDOWN)
					.query({...query, by: 'source'})
					.expect(200),
				agent.get(CASH_FLOW).query(query).expect(200),
			]);

			const employer = {key: 'INCOME:example employer', label: 'Example Employer'};
			expect(body).toEqual({
				baseCurrency: 'EUR',
				interval: 'year',
				by: 'source',
				periods: [
					{
						start: '2025-01-01',
						end: '2025-12-31',
						complete: false,
						total: '2025.00',
						parts: [
							{...employer, amount: '2000.00'},
							{key: 'Market Stall', label: 'Market Stall', amount: '25.00'},
						],
					},
					{
						start: '2026-01-01',
						end: ASOF,
						complete: false,
						total: '1000.00',
						parts: [{...employer, amount: '1000.00'}],
					},
				],
			});
			expect(body.periods.map(({total}: {total: string}) => total)).toEqual(
				flow.periods.map(({income}: {income: string}) => income),
			);
		});

		it('leaves out another owner’s rows', async () => {
			const {body} = await otherAgent
				.get(BREAKDOWN)
				.query({interval: 'year', by: 'category', from: '2025-01-01', to: ASOF, asOf: ASOF})
				.expect(200);
			expect(body.periods).toEqual([
				{
					start: '2026-01-01',
					end: ASOF,
					complete: false,
					total: '7777.00',
					parts: [{key: 'FOOD_AND_DRINK', label: 'FOOD_AND_DRINK', amount: '7777.00'}],
				},
			]);
		});

		it.each([
			['240 months', {interval: 'month', from: '2006-04-01', to: ASOF, asOf: ASOF}],
			['20 years', {interval: 'year', from: '2007-01-01', to: ASOF, asOf: ASOF}],
		])('accepts exactly %s', async (_case, query) => {
			await agent
				.get(BREAKDOWN)
				.query({...query, by: 'category'})
				.expect(200);
		});

		it.each([
			['a range that runs backwards', {interval: 'month', from: '2026-03-02', to: '2026-03-01', asOf: ASOF}],
			['more than 240 months', {interval: 'month', from: '2006-03-31', to: ASOF, asOf: ASOF}],
			['more than 20 years', {interval: 'year', from: '2006-12-31', to: ASOF, asOf: ASOF}],
			['an end after the given date', {interval: 'month', from: '2026-01-01', to: '2026-03-11', asOf: ASOF}],
		])('explains why it rejects %s', async (_case, query) => {
			const {body} = await agent
				.get(BREAKDOWN)
				.query({...query, by: 'category'})
				.expect(400);
			expect(body.message).toBe(BANKING_TRANSACTION_BREAKDOWN_RANGE);
		});

		it.each([
			['weeks', {interval: 'week', by: 'category'}],
			['an unknown dimension', {interval: 'month', by: 'merchant'}],
			['a missing dimension', {interval: 'month'}],
			['an impossible day', {interval: 'month', by: 'category', to: '2026-02-30'}],
		])('rejects %s', async (_case, query) => {
			await agent
				.get(BREAKDOWN)
				.query({from: '2026-01-01', to: ASOF, asOf: ASOF, ...query})
				.expect(400);
		});
	});

	describe('events', () => {
		let agent: TestAgent;
		let otherAgent: TestAgent;
		const ASOF = '2026-11-05';

		beforeAll(async () => {
			const owner = await verifiedOwner();
			const other = await verifiedOwner();
			agent = owner.agent;
			otherAgent = other.agent;
			// A usual month: rent and groceries, €1,000 of spending, with a salary every month from January 2024.
			const everyMonth = months('2024-01', '2026-11').flatMap((month) => [
				named(`${month}-01`, '-800.00', 'Example Landlord', {category: 'HOUSING_AND_UTILITIES'}),
				named(`${month}-03`, '-200.00', 'Corner Shop', {category: 'FOOD_AND_DRINK'}),
				...(month < '2026-11'
					? [named(`${month}-25`, '2000.00', 'Example Employer', {category: 'INCOME'})]
					: []),
			]);
			await fixtures.createTransactions(owner.bankAccount, [
				...everyMonth,
				// Inside the first year of history: no usual month yet.
				named('2024-02-10', '-900.00', 'Example Garage', {category: 'TRANSPORTATION'}),
				named('2025-03-12', '-1200.00', 'Example Travel', {category: 'TRAVEL'}),
				// The regular landlord, but twice the rent: not regular.
				named('2025-05-03', '-1600.00', 'Example Landlord', {category: 'HOUSING_AND_UTILITIES'}),
				named('2025-07-15', '3000.00', 'Example Bonus', {category: 'INCOME'}),
				// Refunds lower the usual month and are never events.
				named('2025-08-20', '700.00', 'Example Travel', {category: 'REFUND'}),
				// Regular from its second payment on: the same payer within three months, within 25%.
				named('2025-09-10', '600.00', 'Example Side Job', {category: 'INCOME'}),
				named('2025-10-10', '640.00', 'Example Side Job', {category: 'INCOME'}),
				named('2025-11-10', '560.00', 'Example Side Job', {category: 'INCOME'}),
				// Internal moves count nowhere, even when large.
				named('2025-09-20', '-5000.00', 'Own Savings', {category: null, ownTransferEvidence: 'IBAN'}),
				named('2025-09-21', '-5000.00', 'Exchange', {
					category: null,
					categoryStatus: 'NOT_APPLICABLE',
					...CURRENCY_EXCHANGE_EVENT,
				}),
				named('2025-10-05', '-400.00', 'Example Shop', {category: 'SHOPPING'}),
				named('2025-12-02', '-3000.00', 'Foreign Shop', {category: 'SHOPPING', amountInBaseCurrency: null}),
				named('2026-02-14', '-700.00', 'Example Clinic', {category: 'HEALTH'}),
				// The running month has no events.
				named('2026-11-02', '-2500.00', 'Example Furniture', {category: 'SHOPPING'}),
			]);
			await fixtures.createTransactions(other.bankAccount, [
				named('2025-06-10', '-9999.00', 'Example Garage', {category: 'TRANSPORTATION'}),
			]);
		});

		const event = (
			date: string,
			name: string,
			category: string,
			direction: 'INCOME' | 'EXPENSE',
			amount: string,
			usualMonth: string,
			share: number,
		) => ({id: expect.any(String), date, name, category, direction, amount, usualMonth, share});

		it('lists large payments that are not regular, measured against the 12 months before', async () => {
			const {body} = await agent.get(EVENTS).query({from: '2024-01-01', to: ASOF, asOf: ASOF}).expect(200);

			expect(body).toEqual({
				baseCurrency: 'EUR',
				events: [
					event('2025-03-12', 'Example Travel', 'TRAVEL', 'EXPENSE', '1200.00', '1000.00', 1.2),
					event(
						'2025-05-03',
						'Example Landlord',
						'HOUSING_AND_UTILITIES',
						'EXPENSE',
						'1600.00',
						'1100.00',
						1.45,
					),
					event('2025-07-15', 'Example Bonus', 'INCOME', 'INCOME', '3000.00', '1233.33', 2.43),
					// The usual month includes the refund and the shop, but no internal move.
					event('2026-02-14', 'Example Clinic', 'HEALTH', 'EXPENSE', '700.00', '1208.33', 0.58),
				],
			});

			const {body: cut} = await agent
				.get(EVENTS)
				.query({from: '2025-04-01', to: '2025-12-31', asOf: ASOF})
				.expect(200);
			expect(cut.events.map(({date}: {date: string}) => date)).toEqual(['2025-05-03', '2025-07-15']);
		});

		it('counts only payments up to the given day, so a first payment is an event until it repeats', async () => {
			const {body} = await agent
				.get(EVENTS)
				.query({from: '2025-09-01', to: '2025-10-05', asOf: '2025-10-05'})
				.expect(200);
			expect(body.events).toEqual([
				event('2025-09-10', 'Example Side Job', 'INCOME', 'INCOME', '600.00', '1175.00', 0.51),
			]);
		});

		it('leaves out another owner’s payments', async () => {
			const {body} = await otherAgent.get(EVENTS).query({from: '2024-01-01', to: ASOF, asOf: ASOF}).expect(200);
			expect(body).toEqual({baseCurrency: 'EUR', events: []});
		});

		it.each([
			['a range that runs backwards', {from: '2026-02-02', to: '2026-02-01', asOf: ASOF}],
			['an end after the given date', {from: '2026-01-01', to: '2026-11-06', asOf: ASOF}],
		])('explains why it rejects %s', async (_case, query) => {
			const {body} = await agent.get(EVENTS).query(query).expect(400);
			expect(body.message).toBe(BANKING_TRANSACTION_EVENTS_RANGE);
		});

		it.each([
			['a missing date', {from: '2026-01-01', to: '2026-02-01'}],
			['an impossible day', {from: '2026-01-01', to: '2026-02-30', asOf: ASOF}],
		])('rejects %s', async (_case, query) => {
			await agent.get(EVENTS).query(query).expect(400);
		});
	});
});
