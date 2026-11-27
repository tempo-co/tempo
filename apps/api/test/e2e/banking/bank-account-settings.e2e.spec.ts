import {INestApplication} from '@nestjs/common';
import type {
	BankBalanceTrend,
	BankConnection as BankConnectionResponse,
	BankTransaction as BankTransactionResponse,
	BankTransactionsResponse,
} from '@wisp/contracts';
import {Server} from 'node:net';
import TestAgent from 'supertest/lib/agent';

import {Account} from '@modules/account/account.entity';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {McpReaderService} from '@modules/banking/services/mcp-reader.service';

import {BankingFixtures, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

const AS_OF = '2026-08-31';
const AUGUST = {'filter[date][from]': '2026-08-01', 'filter[date][to]': '2026-08-31'};
const GYM = {description: 'Example Gym', counterpartyName: 'Example Gym', category: 'HEALTH'};
const GYM_MONTHS = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
const REPORTED = new Date('2026-08-31T12:00:00Z');

describe('Bank account settings', () => {
	let app: INestApplication<Server>;
	let fixtures: BankingFixtures;

	beforeAll(() => {
		app = getApp();
		fixtures = new BankingFixtures(app);
	});

	/**
	 * An owner whose main account holds an Example Market payment and a salary in August, and whose second account holds
	 * a monthly Example Gym payment from March to August, an Example Shop payment and a transfer to the main account;
	 * and a second owner with an account of their own.
	 */
	async function seed() {
		const owner = await createBankingOwner(app, {baseCurrency: 'EUR'});
		await fixtures.bankAccounts.update(
			{id: owner.bankAccount.id},
			{currentBalanceAmount: '1500.00', balanceUpdatedAt: REPORTED},
		);
		const card = await fixtures.createBankAccount(owner.connection, {
			name: 'Card account',
			currentBalanceAmount: '200.00',
			balanceUpdatedAt: REPORTED,
		});
		const [market, salary] = await fixtures.createTransactions(owner.bankAccount, [
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
		]);
		const gym = await fixtures.createTransactions(
			card,
			GYM_MONTHS.map((month) => bookedRow(`${month}-05`, '-30.00', GYM)),
		);
		const [shop, transfer] = await fixtures.createTransactions(card, [
			bookedRow('2026-08-12', '-50.00', {description: 'Example Shop', counterpartyName: 'Example Shop'}),
			bookedRow('2026-08-15', '-100.00', {
				description: 'Example Savings',
				counterpartyName: 'Example Savings',
				category: 'TRANSFER_OUT',
				ownTransferEvidence: 'IBAN',
			}),
		]);
		const other = await createBankingOwner(app, {baseCurrency: 'EUR'});
		const othersRow = await fixtures.createTransaction(other.bankAccount, bookedRow('2026-08-12', '-9.00'));
		return {owner, card, market, salary, gym, shop, transfer, other, othersRow};
	}

	/** Every read that totals the owner's history, from the REST endpoints the app calls. */
	async function reads(agent: TestAgent) {
		const get = async (path: string, query: Record<string, string>) =>
			(await agent.get(path).query(query).expect(200)).body as unknown;
		return {
			recurring: await get('/recurring-series', {asOf: AS_OF}),
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
			balanceTrend: await get('/bank-transactions/balance-trend', {
				interval: 'month',
				from: '2026-03-01',
				to: AS_OF,
				asOf: AS_OF,
			}),
		};
	}

	const connectionsOf = async (agent: TestAgent) =>
		(await agent.get('/bank-connections').expect(200)).body as BankConnectionResponse[];
	const accountOf = async (agent: TestAgent, id: string) =>
		(await connectionsOf(agent)).flatMap(({bankAccounts}) => bankAccounts).find((account) => account.id === id);
	const listed = async (agent: TestAgent, query: Record<string, string>) =>
		((await agent.get('/bank-transactions').query(query).expect(200)).body as BankTransactionsResponse)
			.transactions;
	const recurringOf = async (agent: TestAgent, id: string) =>
		(await agent.get(`/bank-transactions/${id}/recurring`).query({asOf: AS_OF}).expect(200)).body as unknown;

	it('names the account as the owner renamed it in every account read, and goes back to the bank’s name', async () => {
		const {owner, card, shop, transfer} = await seed();
		const {agent} = owner;
		// The main account's leg of the transfer, paired with the card's.
		const [received] = await fixtures.createTransactions(owner.bankAccount, [
			bookedRow('2026-08-15', '100.00', {
				creditDebitIndicator: 'CRDT',
				description: 'Example Savings',
				ownTransferEvidence: 'IBAN',
				ownTransferCounterpartId: transfer.id,
			}),
		]);

		const response = await agent
			.patch(`/bank-connections/${owner.connection.id}/accounts/${card.id}`)
			.send({alias: '  Holiday card  '})
			.expect(200);

		expect(response.body).toMatchObject({
			id: card.id,
			name: 'Card account',
			alias: 'Holiday card',
			isHidden: false,
		});
		expect(await accountOf(agent, card.id)).toMatchObject({alias: 'Holiday card'});
		expect((await listed(agent, AUGUST)).find(({id}) => id === shop.id)).toMatchObject({
			bankAccountName: 'Card account',
			bankAccountAlias: 'Holiday card',
		});
		const detail = async (id: string) =>
			(await agent.get(`/bank-transactions/${id}`).expect(200)).body as BankTransactionResponse;
		expect(await detail(shop.id)).toMatchObject({bankAccountAlias: 'Holiday card'});
		expect((await detail(received.id)).ownTransfer?.counterpart).toMatchObject({
			id: transfer.id,
			bankAccountAlias: 'Holiday card',
		});
		// The AI assistant lists the account by the same name.
		const assistant = await app.get(McpReaderService).forAccount(owner.owner).listAccounts();
		expect(assistant.flatMap(({bankAccounts}) => bankAccounts).find(({id}) => id === card.id)).toMatchObject({
			alias: 'Holiday card',
		});

		// A blank name goes back to the bank's, as null does.
		await agent
			.patch(`/bank-connections/${owner.connection.id}/accounts/${card.id}`)
			.send({alias: '   '})
			.expect(200);
		expect(await accountOf(agent, card.id)).toMatchObject({name: 'Card account', alias: null});
		await agent
			.patch(`/bank-connections/${owner.connection.id}/accounts/${card.id}`)
			.send({alias: 'Holiday card'})
			.expect(200);
		await agent
			.patch(`/bank-connections/${owner.connection.id}/accounts/${card.id}`)
			.send({alias: null})
			.expect(200);
		expect(await accountOf(agent, card.id)).toMatchObject({alias: null});

		await agent
			.patch(`/bank-connections/${owner.connection.id}/accounts/${card.id}`)
			.send({alias: 'x'.repeat(101)})
			.expect(400);
		expect(await accountOf(agent, card.id)).toMatchObject({alias: null});
	});

	it('takes a hidden account’s rows out of every total and the AI assistant’s reads, keeps them listed and its balance, and puts them back when shown', async () => {
		const {owner, card, gym, shop} = await seed();
		const {agent} = owner;
		const before = await reads(agent);
		expect(before.totals).toMatchObject({spending: '100.00', income: '2000.00'});
		expect(before.summary).toMatchObject({totals: {spending: '100.00', ownTransfers: '100.00'}});
		expect(await recurringOf(agent, gym.at(-1)!.id)).not.toBeNull();

		const response = await agent
			.patch(`/bank-connections/${owner.connection.id}/accounts/${card.id}`)
			.send({isHidden: true})
			.expect(200);

		expect(response.body).toMatchObject({id: card.id, isHidden: true, currentBalanceAmount: '200.00000000'});
		expect(await accountOf(agent, owner.bankAccount.id)).toMatchObject({isHidden: false});
		const after = await reads(agent);
		// The list still counts the account's rows.
		expect(after.totals).toMatchObject({spending: '20.00', income: '2000.00', count: 5});
		expect(after.summary).toMatchObject({totals: {spending: '20.00', income: '2000.00', ownTransfers: '0.00'}});
		expect(
			(after.summary as {categories: Array<{category: string}>}).categories.map(({category}) => category),
		).toEqual(['GROCERIES']);
		expect((after.cashFlow as {periods: Array<{spending: string}>}).periods.map(({spending}) => spending)).toEqual([
			'0.00',
			'0.00',
			'0.00',
			'0.00',
			'0.00',
			'20.00',
		]);
		const parts = (after.breakdown as {periods: Array<{total: string; parts: Array<{key: string}>}>}).periods[0];
		expect(parts).toMatchObject({total: '20.00'});
		expect(parts.parts.map(({key}) => key)).toEqual(['GROCERIES']);
		const rankedNames = (body: unknown) =>
			(body as {merchants: Array<{name: string}>}).merchants.map(({name}) => name);
		expect(rankedNames(before.ranking)).toEqual(['Example Shop', 'Example Gym', 'Example Market']);
		expect(rankedNames(after.ranking)).toEqual(['Example Market']);
		const spentAt = (body: unknown, name: string) =>
			(body as {merchants: Array<{name: string; spent: string}>}).merchants.find(
				(merchant) => merchant.name === name,
			)?.spent;
		expect(spentAt(before.merchants, 'Example Gym')).toBe('180.00');
		expect(spentAt(after.merchants, 'Example Gym') ?? '0.00').toBe('0.00');
		expect(spentAt(after.merchants, 'Example Market')).toBe('20.00');
		// Recurring detection no longer sees the account's payments.
		expect(await recurringOf(agent, gym.at(-1)!.id)).toBeNull();
		expect(after.recurring).not.toEqual(before.recurring);
		// The balance total leaves the account out; the account keeps its own balance.
		const august = (body: unknown) => (body as BankBalanceTrend).periods.at(-1)!;
		expect(august(before.balanceTrend)).toMatchObject({total: '1700.00'});
		expect(august(after.balanceTrend)).toMatchObject({
			total: '1500.00',
			accounts: expect.arrayContaining([{id: card.id, balance: '200.00'}]),
		});
		// Before the main account's history, only the hidden account has a balance: no total, but its own history.
		const march = (body: unknown) => (body as BankBalanceTrend).periods[0];
		expect(march(before.balanceTrend)).toMatchObject({start: '2026-03-01', total: '500.00'});
		expect(march(after.balanceTrend)).toMatchObject({
			start: '2026-03-01',
			total: null,
			accounts: expect.arrayContaining([{id: card.id, balance: '500.00'}]),
		});

		// The AI assistant reads the same totals.
		const reader = app.get(McpReaderService).forAccount(owner.owner);
		expect(await reader.transactionTotals({filters: {date: {from: '2026-08-01', to: '2026-08-31'}}})).toEqual(
			after.totals,
		);
		expect(await reader.monthSummary({month: '2026-08', asOf: AS_OF})).toEqual(after.summary);
		expect(await reader.listRecurring({asOf: AS_OF})).toEqual(after.recurring);

		// Its rows stay in the list, marked.
		const rows = await listed(agent, AUGUST);
		expect(rows.find(({id}) => id === shop.id)).toMatchObject({bankAccountHidden: true, leftOutOfTotals: false});
		expect(rows.filter(({bankAccountId}) => bankAccountId === owner.bankAccount.id)).toEqual(
			expect.arrayContaining([expect.objectContaining({bankAccountHidden: false})]),
		);
		expect(
			rows.some(
				({bankAccountId, bankAccountHidden}) => bankAccountId === owner.bankAccount.id && bankAccountHidden,
			),
		).toBe(false);

		await agent
			.patch(`/bank-connections/${owner.connection.id}/accounts/${card.id}`)
			.send({isHidden: false})
			.expect(200);

		expect(await reads(agent)).toEqual(before);
		expect(await recurringOf(agent, gym.at(-1)!.id)).not.toBeNull();
	});

	it("refuses another owner's account, or one named under another connection, for rename, hide and remove, and changes nothing", async () => {
		const {owner, card, other} = await seed();
		const bankAccounts = fixtures.bankAccounts;
		const state = async () =>
			(await bankAccounts.findBy([{id: card.id}, {id: other.bankAccount.id}]))
				.sort((left, right) => left.id.localeCompare(right.id))
				.map(({id, alias, isHidden}: BankAccount) => ({id, alias, isHidden}));
		const before = await state();
		const rows = async (account: Pick<Account, 'id'>) =>
			fixtures.transactions.count({where: {bankAccount: {bankConnection: {accountId: account.id}}}});
		const rowsBefore = {owner: await rows(owner.owner), other: await rows(other.owner)};
		const otherPath = `/bank-connections/${other.connection.id}/accounts/${other.bankAccount.id}`;
		// The owner's own account, named under the other owner's connection.
		const crossedPath = `/bank-connections/${other.connection.id}/accounts/${card.id}`;

		for (const path of [otherPath, crossedPath]) {
			await owner.agent.patch(path).send({alias: 'Taken'}).expect(404);
			await owner.agent.patch(path).send({isHidden: true}).expect(404);
			await owner.agent.delete(path).send({confirmation: 'DELETE'}).expect(404);
		}
		// A synced account goes with its connection's removal, and a removal is confirmed.
		await owner.agent
			.delete(`/bank-connections/${owner.connection.id}/accounts/${card.id}`)
			.send({confirmation: 'DELETE'})
			.expect(409);
		await owner.agent.delete(`/bank-connections/${owner.connection.id}/accounts/${card.id}`).send({}).expect(400);
		for (const isHidden of ['yes', null]) {
			await owner.agent
				.patch(`/bank-connections/${owner.connection.id}/accounts/${card.id}`)
				.send({isHidden})
				.expect(400);
		}

		expect(await state()).toEqual(before);
		expect({owner: await rows(owner.owner), other: await rows(other.owner)}).toEqual(rowsBefore);
	});
});
