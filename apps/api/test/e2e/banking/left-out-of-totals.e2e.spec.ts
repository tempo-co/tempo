import {INestApplication} from '@nestjs/common';
import type {BankTransactionsResponse} from '@tempo/contracts';
import {Server} from 'node:net';
import TestAgent from 'supertest/lib/agent';

import {Account} from '@modules/account/account.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {McpReaderService} from '@modules/banking/services/mcp-reader.service';

import {BankingFixtures, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

const AS_OF = '2026-08-31';
const AUGUST = {'filter[date][from]': '2026-08-01', 'filter[date][to]': '2026-08-31'};
const GYM = {description: 'Example Gym', counterpartyName: 'Example Gym', category: 'HEALTH'};
const GYM_MONTHS = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];

describe('Leave out of totals', () => {
	let app: INestApplication<Server>;
	let fixtures: BankingFixtures;

	beforeAll(() => {
		app = getApp();
		fixtures = new BankingFixtures(app);
	});

	/**
	 * An owner with a monthly Example Gym payment from March to August, and in August an Example Shop payment, an
	 * Example Market payment and a salary; and a second owner with a row of their own.
	 */
	async function seed() {
		const owner = await createBankingOwner(app, {baseCurrency: 'EUR'});
		await fixtures.bankAccounts.update(
			{id: owner.bankAccount.id},
			{currentBalanceAmount: '1500.00', balanceUpdatedAt: new Date('2026-08-31T12:00:00Z')},
		);
		const gym = await fixtures.createTransactions(
			owner.bankAccount,
			GYM_MONTHS.map((month) => bookedRow(`${month}-05`, '-30.00', GYM)),
		);
		const [shop, market, , transfer] = await fixtures.createTransactions(owner.bankAccount, [
			bookedRow('2026-08-12', '-50.00', {description: 'Example Shop', counterpartyName: 'Example Shop'}),
			bookedRow('2026-08-20', '-20.00', {
				description: 'Example Market',
				counterpartyName: 'Example Market',
				category: 'GROCERIES',
			}),
			bookedRow('2026-08-25', '2000.00', {
				description: 'Example Employer',
				counterpartyName: 'Example Employer',
				category: 'INCOME',
			}),
			bookedRow('2026-08-15', '-100.00', {
				description: 'Example Savings',
				counterpartyName: 'Example Savings',
				category: 'TRANSFER_OUT',
				ownTransferEvidence: 'IBAN',
			}),
		]);
		const other = await createBankingOwner(app, {baseCurrency: 'EUR'});
		const othersRow = await fixtures.createTransaction(other.bankAccount, bookedRow('2026-08-12', '-9.00'));
		return {owner, gym, shop, market, transfer, other, othersRow};
	}

	/** Every read that totals the owner's August, from the REST endpoints the app calls. */
	async function reads(agent: TestAgent) {
		const get = async (path: string, query: Record<string, string>) =>
			(await agent.get(path).query(query).expect(200)).body as unknown;
		return {
			totals: await get('/bank-transactions/totals', AUGUST),
			dayTotals: await get('/bank-transactions/day-totals', AUGUST),
			summary: await get('/bank-transactions/summary', {month: '2026-08', asOf: AS_OF}),
			cashFlow: await get('/bank-transactions/cash-flow', {
				interval: 'month',
				from: '2026-03-01',
				to: AS_OF,
				asOf: AS_OF,
			}),
			breakdown: await get('/bank-transactions/breakdown', {
				interval: 'month',
				by: 'category',
				from: '2026-08-01',
				to: AS_OF,
				asOf: AS_OF,
			}),
			ranking: await get('/merchants/ranking', {interval: 'month', period: '2026-08-01', asOf: AS_OF}),
			merchants: await get('/merchants', {}),
			recurring: await get('/recurring-series', {asOf: AS_OF}),
			balanceTrend: await get('/bank-transactions/balance-trend', {
				interval: 'month',
				from: '2026-03-01',
				to: AS_OF,
				asOf: AS_OF,
			}),
		};
	}

	/** The same reads through the AI assistant's (MCP) tools. */
	async function mcpReads(owner: Account) {
		const reader = app.get(McpReaderService).forAccount(owner);
		const august = {date: {from: '2026-08-01', to: '2026-08-31'}};
		return {
			totals: await reader.transactionTotals({filters: august}),
			summary: await reader.monthSummary({month: '2026-08', asOf: AS_OF}),
			cashFlow: await reader.cashFlow({interval: 'month', from: '2026-03-01', to: AS_OF, asOf: AS_OF}),
			breakdown: await reader.spendingBreakdown({
				interval: 'month',
				by: 'category',
				from: '2026-08-01',
				to: AS_OF,
				asOf: AS_OF,
			}),
			ranking: await reader.merchantRanking({interval: 'month', period: '2026-08-01', asOf: AS_OF}),
			merchants: await reader.listMerchants({}),
			recurring: await reader.listRecurring({asOf: AS_OF}),
		};
	}

	const listed = async (agent: TestAgent, query: Record<string, string>) =>
		((await agent.get('/bank-transactions').query(query).expect(200)).body as BankTransactionsResponse)
			.transactions;
	const recurringOf = async (agent: TestAgent, id: string) =>
		(await agent.get(`/bank-transactions/${id}/recurring`).query({asOf: AS_OF}).expect(200)).body as unknown;

	it('leaves one payment out of every total and the AI assistant’s reads, keeps it listed and the balance, and puts it back', async () => {
		const {owner, gym} = await seed();
		const {agent} = owner;
		const augustGym = gym.at(-1)!;
		const before = await reads(agent);
		expect(before.totals).toMatchObject({spending: '100.00', income: '2000.00'});
		expect(await recurringOf(agent, augustGym.id)).not.toBeNull();

		const response = await agent
			.patch(`/bank-transactions/${augustGym.id}/left-out-of-totals`)
			.send({leftOutOfTotals: true})
			.expect(200);

		expect(response.body).toMatchObject({id: augustGym.id, leftOutOfTotals: true});
		const after = await reads(agent);
		expect(after.totals).toMatchObject({spending: '70.00', income: '2000.00', count: 5});
		// Its day keeps a header in the list, with nothing counted.
		expect(after.dayTotals).toMatchObject({
			days: expect.arrayContaining([{date: '2026-08-05', spending: '0.00', income: '0.00', net: '0.00'}]),
		});
		expect(after.summary).toMatchObject({totals: {spending: '70.00', income: '2000.00'}});
		expect(
			(after.summary as {categories: Array<{category: string}>}).categories.map(({category}) => category),
		).toEqual(['SHOPPING', 'GROCERIES']);
		expect((after.cashFlow as {periods: Array<{spending: string}>}).periods.map(({spending}) => spending)).toEqual([
			'30.00',
			'30.00',
			'30.00',
			'30.00',
			'30.00',
			'70.00',
		]);
		const parts = (after.breakdown as {periods: Array<{total: string; parts: Array<{key: string}>}>}).periods[0];
		expect(parts).toMatchObject({total: '70.00'});
		expect(parts.parts.map(({key}) => key)).toEqual(['SHOPPING', 'GROCERIES']);
		const rankedNames = (body: unknown) =>
			(body as {merchants: Array<{name: string}>}).merchants.map(({name}) => name);
		expect(rankedNames(before.ranking)).toContain('Example Gym');
		expect(rankedNames(after.ranking)).toEqual(['Example Shop', 'Example Market']);
		const gymGroup = (body: unknown) =>
			(body as {merchants: Array<{name: string; spent: string}>}).merchants.find(
				({name}) => name === 'Example Gym',
			);
		expect(gymGroup(before.merchants)).toMatchObject({spent: '180.00'});
		expect(gymGroup(after.merchants)).toMatchObject({spent: '150.00'});
		// Recurring detection no longer sees the payment; the earlier ones still make the series.
		expect(await recurringOf(agent, augustGym.id)).toBeNull();
		const series = (await recurringOf(agent, gym.at(-2)!.id)) as {payments: Array<{id: string}>};
		expect(series.payments.map(({id}) => id)).toEqual([gym[4].id, gym[3].id, gym[2].id]);
		// The money did move.
		expect(after.balanceTrend).toEqual(before.balanceTrend);

		// The AI assistant reads the same totals.
		const mcp = await mcpReads(owner.owner);
		expect(mcp).toEqual({
			totals: after.totals,
			summary: after.summary,
			cashFlow: after.cashFlow,
			breakdown: after.breakdown,
			ranking: after.ranking,
			merchants: after.merchants,
			recurring: after.recurring,
		});

		// The row stays in the list, marked, and the list can show only rows left out.
		const august = await listed(agent, AUGUST);
		expect(august.map(({id}) => id)).toContain(augustGym.id);
		expect(august.find(({id}) => id === augustGym.id)).toMatchObject({leftOutOfTotals: true});
		expect(august.filter(({id}) => id !== augustGym.id).every(({leftOutOfTotals}) => !leftOutOfTotals)).toBe(true);
		expect((await listed(agent, {'filter[cashFlows][]': 'LEFT_OUT'})).map(({id}) => id)).toEqual([augustGym.id]);
		expect((await listed(agent, {...AUGUST, 'filter[cashFlows][]': 'SPENDING'})).map(({id}) => id)).not.toContain(
			augustGym.id,
		);
		expect(
			await agent.get('/bank-transactions/totals').query({'filter[cashFlows][]': 'LEFT_OUT'}).expect(200),
		).toMatchObject({body: {spending: '0.00', income: '0.00', count: 1}});

		await agent
			.patch(`/bank-transactions/${augustGym.id}/left-out-of-totals`)
			.send({leftOutOfTotals: false})
			.expect(200);

		expect(await reads(agent)).toEqual(before);
		expect(await recurringOf(agent, augustGym.id)).not.toBeNull();
	});

	it('leaves picked rows, or every row a filter matches, out of totals in one write, and counts them again', async () => {
		const {owner, gym, shop, market, transfer} = await seed();
		const {agent} = owner;
		const totals = async () =>
			(await agent.get('/bank-transactions/totals').query(AUGUST).expect(200)).body as unknown;
		const ownTransfers = async () =>
			(
				(await agent.get('/bank-transactions/summary').query({month: '2026-08', asOf: AS_OF}).expect(200))
					.body as {totals: {ownTransfers: string}}
			).totals.ownTransfers;
		const before = await totals();
		expect(await ownTransfers()).toBe('100.00');

		const picked = await agent
			.patch('/bank-transactions/bulk-left-out-of-totals')
			.send({transactionIds: [shop.id, market.id, transfer.id], leftOutOfTotals: true})
			.expect(200);

		expect(picked.body).toEqual({updated: 3});
		expect(await totals()).toMatchObject({spending: '30.00', income: '2000.00'});
		// An own transfer left out leaves the money moved between accounts too.
		expect(await ownTransfers()).toBe('0.00');
		// Rows already left out are not written again.
		await agent
			.patch('/bank-transactions/bulk-left-out-of-totals')
			.send({transactionIds: [shop.id, market.id, transfer.id], leftOutOfTotals: true})
			.expect(200, {updated: 0});

		const filtered = await agent
			.patch('/bank-transactions/bulk-left-out-of-totals')
			.send({filter: {search: 'Example Gym'}, leftOutOfTotals: true})
			.expect(200);
		expect(filtered.body).toEqual({updated: gym.length});
		expect(await totals()).toMatchObject({spending: '0.00', income: '2000.00'});

		await agent
			.patch('/bank-transactions/bulk-left-out-of-totals')
			.send({filter: {cashFlows: ['LEFT_OUT']}, leftOutOfTotals: false})
			.expect(200, {updated: gym.length + 3});
		expect(await totals()).toEqual(before);
		expect(await ownTransfers()).toBe('100.00');
	});

	it("refuses another owner's row, alone or in a selection, and writes nothing", async () => {
		const {owner, shop, other, othersRow} = await seed();
		const flags = async () =>
			(await fixtures.transactions.findBy({id: shop.id}))
				.concat(await fixtures.transactions.findBy({id: othersRow.id}))
				.map(({id, leftOutOfTotals}: BankTransaction) => ({id, leftOutOfTotals}));
		const before = await flags();

		await owner.agent
			.patch(`/bank-transactions/${othersRow.id}/left-out-of-totals`)
			.send({leftOutOfTotals: true})
			.expect(404);
		await owner.agent
			.patch('/bank-transactions/bulk-left-out-of-totals')
			.send({transactionIds: [shop.id, othersRow.id], leftOutOfTotals: true})
			.expect(404);
		await other.agent
			.patch('/bank-transactions/bulk-left-out-of-totals')
			.send({filter: {search: 'Example Shop'}, leftOutOfTotals: true})
			.expect(404);
		// A selection is the ids or the filter, never both, and the choice is a yes or no.
		await owner.agent
			.patch('/bank-transactions/bulk-left-out-of-totals')
			.send({transactionIds: [shop.id], filter: {search: 'Example Shop'}, leftOutOfTotals: true})
			.expect(400);
		await owner.agent.patch(`/bank-transactions/${shop.id}/left-out-of-totals`).send({}).expect(400);

		expect(await flags()).toEqual(before);
		expect(before.every(({leftOutOfTotals}) => !leftOutOfTotals)).toBe(true);
	});
});
