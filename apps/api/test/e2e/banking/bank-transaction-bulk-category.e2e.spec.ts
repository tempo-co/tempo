import {INestApplication} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Server} from 'node:net';
import {DeepPartial} from 'typeorm';

import {BankTransaction} from '@modules/banking/bank-transaction.entity';

import {BankingFixtures, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {expectValidationMessage} from '../../utils/auth-utils';
import {createBankingOwner} from '../../utils/banking-utils';

const EXAMPLE_CAFE = {description: 'Example Cafe', counterpartyName: 'Example Cafe'};
const EXAMPLE_BAKERY = {description: 'Example Bakery', counterpartyName: 'Example Bakery'};
const EXAMPLE_SHOP = {description: 'Example Shop', counterpartyName: 'Example Shop'};

const PREVIEW_PATH = '/bank-transactions/bulk-category/preview';
const UPDATE_PATH = '/bank-transactions/bulk-category';

/** A row automation has categorized, as sync leaves it: with an input hash. */
function categorizedRow(bookingDate: string, amount: string, overrides: DeepPartial<BankTransaction> = {}) {
	return bookedRow(bookingDate, amount, {categoryInputHash: `hash-${randomUUID()}`, ...overrides});
}

function pickCategory({category, categorySource, categoryStatus, categoryUpdatedAt}: BankTransaction) {
	return {category, categorySource, categoryStatus, categoryUpdatedAt};
}

describe('Bulk category', () => {
	let app: INestApplication<Server>;
	let fixtures: BankingFixtures;

	beforeAll(() => {
		app = getApp();
		fixtures = new BankingFixtures(app);
	});

	/**
	 * An owner with three payees and a second owner sharing one of them. The selection is two cafe rows, one bakery row
	 * and one shop row. The owner chose Eating out for the bakery before, and Shopping for the shop, so a bulk Eating
	 * out agrees with the bakery's choice and disagrees with the shop's.
	 */
	async function seed() {
		const owner = await createBankingOwner(app, {baseCurrency: null});
		const other = await createBankingOwner(app, {baseCurrency: null});
		const create = (account: typeof owner.bankAccount, overrides: DeepPartial<BankTransaction>) =>
			fixtures.createTransaction(account, overrides);
		const rows = {
			cafeA: await create(owner.bankAccount, categorizedRow('2026-09-10', '-3.00', EXAMPLE_CAFE)),
			cafeB: await create(owner.bankAccount, categorizedRow('2026-09-08', '-4.00', EXAMPLE_CAFE)),
			cafeOther: await create(owner.bankAccount, categorizedRow('2026-09-09', '-5.00', EXAMPLE_CAFE)),
			// The model already picked Eating out: changing it would change nothing visible.
			cafeSame: await create(
				owner.bankAccount,
				categorizedRow('2026-09-07', '-6.00', {...EXAMPLE_CAFE, category: 'EATING_OUT'}),
			),
			bakery: await create(owner.bankAccount, categorizedRow('2026-09-06', '-7.00', EXAMPLE_BAKERY)),
			bakeryChoice: await create(
				owner.bankAccount,
				categorizedRow('2026-09-05', '-8.00', {
					...EXAMPLE_BAKERY,
					category: 'EATING_OUT',
					categorySource: 'MANUAL',
				}),
			),
			bakeryOther: await create(
				owner.bankAccount,
				categorizedRow('2026-09-11', '-9.00', {
					...EXAMPLE_BAKERY,
					category: 'TRAVEL',
					categorySource: 'HISTORY',
				}),
			),
			shop: await create(owner.bankAccount, categorizedRow('2026-09-04', '-10.00', EXAMPLE_SHOP)),
			shopChoice: await create(
				owner.bankAccount,
				categorizedRow('2026-09-03', '-11.00', {...EXAMPLE_SHOP, categorySource: 'MANUAL'}),
			),
			shopOther: await create(owner.bankAccount, categorizedRow('2026-09-02', '-12.00', EXAMPLE_SHOP)),
			otherOwnersCafe: await create(other.bankAccount, categorizedRow('2026-09-09', '-13.00', EXAMPLE_CAFE)),
		};
		expect(rows.otherOwnersCafe.merchantKey).toBe(rows.cafeA.merchantKey);
		const selection = [rows.cafeA.id, rows.cafeB.id, rows.bakery.id, rows.shop.id];
		const reload = async (name: keyof typeof rows) => fixtures.transactions.findOneByOrFail({id: rows[name].id});
		const snapshot = async () =>
			Object.fromEntries(
				await Promise.all(
					(Object.keys(rows) as (keyof typeof rows)[]).map(
						async (name) => [name, pickCategory(await reload(name))] as const,
					),
				),
			);
		return {agent: owner.agent, otherAgent: other.agent, rows, selection, reload, snapshot};
	}

	it('previews the other rows from the selected payees that changing all would move, without saving anything', async () => {
		const {agent, rows, selection, snapshot} = await seed();
		const before = await snapshot();

		const response = await agent
			.post(PREVIEW_PATH)
			.send({transactionIds: selection, category: 'EATING_OUT'})
			.expect(200);

		// The shop's earlier choice disagrees, and with AI categorization off nothing is rechecked, so it lists no rows.
		expect(response.body).toEqual({
			selected: 4,
			total: 2,
			transactions: [
				{
					id: rows.bakeryOther.id,
					transactionDate: null,
					bookingDate: '2026-09-11',
					displayDescription: 'Example Bakery',
					amount: '-9.00000000',
					currency: 'EUR',
					category: 'TRAVEL',
					categoryStatus: 'COMPLETED',
					categorySource: 'HISTORY',
					action: 'APPLY',
					appliedCategory: 'EATING_OUT',
				},
				expect.objectContaining({id: rows.cafeOther.id, action: 'APPLY', appliedCategory: 'EATING_OUT'}),
			],
		});
		expect(await snapshot()).toEqual(before);
	});

	it('changes just the selected rows, and remembers them as the owner’s choices', async () => {
		const {agent, rows, selection, reload, snapshot} = await seed();
		const before = await snapshot();

		const response = await agent
			.patch(UPDATE_PATH)
			.send({transactionIds: selection, category: 'EATING_OUT', scope: 'SELECTED'})
			.expect(200);

		expect(response.body).toEqual({updated: 4});
		const inputHashes = new Map<string, string | null>();
		for (const name of ['cafeA', 'cafeB', 'bakery', 'shop'] as const) {
			const row = await reload(name);
			inputHashes.set(name, row.categoryInputHash);
			expect({name, ...row}).toMatchObject({
				name,
				category: 'EATING_OUT',
				categorySource: 'MANUAL',
				categoryStatus: 'COMPLETED',
				categoryProvider: null,
			});
			expect(row.categoryAppliedInputHash).toBe(row.categoryInputHash);
		}
		// Each row stores the hash of its own input: the two cafe rows share one, the bakery and shop have their own.
		expect(inputHashes.get('cafeA')).toMatch(/^[\da-f]{64}$/);
		expect(inputHashes.get('cafeB')).toBe(inputHashes.get('cafeA'));
		expect(new Set(inputHashes.values()).size).toBe(3);
		const after = await snapshot();
		for (const name of ['cafeOther', 'cafeSame', 'bakeryOther', 'shopOther', 'otherOwnersCafe'] as const) {
			expect({name, ...after[name]}).toEqual({name, ...before[name]});
		}
		// The single-row correction counts them as choices: Shopping for the other cafe row now disagrees with them.
		const impact = await agent
			.get(`/bank-transactions/${rows.cafeOther.id}/category-impact?category=SHOPPING`)
			.expect(200);
		expect(impact.body).toMatchObject({action: null, total: 0});
	});

	it('changes all rows from the selected payees that the preview lists, in the same write', async () => {
		const {agent, selection, reload, snapshot} = await seed();
		const before = await snapshot();

		const response = await agent
			.patch(UPDATE_PATH)
			.send({transactionIds: selection, category: 'EATING_OUT', scope: 'ALL'})
			.expect(200);

		expect(response.body).toEqual({updated: 6});
		for (const name of ['cafeA', 'cafeB', 'bakery', 'shop'] as const) {
			expect({name, ...(await reload(name))}).toMatchObject({
				name,
				category: 'EATING_OUT',
				categorySource: 'MANUAL',
			});
		}
		for (const name of ['cafeOther', 'bakeryOther'] as const) {
			const row = await reload(name);
			expect({name, ...row}).toMatchObject({
				name,
				category: 'EATING_OUT',
				categorySource: 'HISTORY',
				categoryStatus: 'COMPLETED',
			});
			expect(row.categoryAppliedInputHash).toBe(row.categoryInputHash);
		}
		const after = await snapshot();
		for (const name of ['cafeSame', 'bakeryChoice', 'shopChoice', 'shopOther', 'otherOwnersCafe'] as const) {
			expect({name, ...after[name]}).toEqual({name, ...before[name]});
		}
	});

	it('changes every row of the owner’s that the filter matches, and the rows its preview lists', async () => {
		const {agent, rows, reload, snapshot} = await seed();
		const before = await snapshot();
		// The cafe rows from 8 September on: the second owner's cafe row matches the filter too, but is not theirs.
		const filter = {search: 'Example Cafe', date: {from: '2026-09-08'}};

		const preview = await agent.post(PREVIEW_PATH).send({filter, category: 'SHOPPING'}).expect(200);

		expect(preview.body).toEqual({
			selected: 3,
			total: 1,
			transactions: [
				expect.objectContaining({id: rows.cafeSame.id, action: 'APPLY', appliedCategory: 'SHOPPING'}),
			],
		});
		expect(await snapshot()).toEqual(before);

		const response = await agent.patch(UPDATE_PATH).send({filter, category: 'SHOPPING', scope: 'ALL'}).expect(200);

		expect(response.body).toEqual({updated: 4});
		for (const name of ['cafeA', 'cafeB', 'cafeOther'] as const) {
			expect({name, ...(await reload(name))}).toMatchObject({
				name,
				category: 'SHOPPING',
				categorySource: 'MANUAL',
			});
		}
		expect(await reload('cafeSame')).toMatchObject({category: 'SHOPPING', categorySource: 'HISTORY'});
		const after = await snapshot();
		for (const name of [
			'bakery',
			'bakeryChoice',
			'bakeryOther',
			'shop',
			'shopChoice',
			'shopOther',
			'otherOwnersCafe',
		] as const) {
			expect({name, ...after[name]}).toEqual({name, ...before[name]});
		}
	});

	it('refuses a selection holding another owner’s transaction or an unknown id, and writes nothing', async () => {
		const {agent, otherAgent, rows, selection, snapshot} = await seed();
		const before = await snapshot();

		for (const transactionIds of [
			[...selection, rows.otherOwnersCafe.id],
			[...selection, randomUUID()],
		]) {
			await agent.post(PREVIEW_PATH).send({transactionIds, category: 'EATING_OUT'}).expect(404);
			for (const scope of ['SELECTED', 'ALL']) {
				await agent.patch(UPDATE_PATH).send({transactionIds, category: 'EATING_OUT', scope}).expect(404);
			}
		}
		await otherAgent
			.patch(UPDATE_PATH)
			.send({transactionIds: selection, category: 'EATING_OUT', scope: 'ALL'})
			.expect(404);
		// A filter that matches none of the owner's rows selects nothing to change.
		const filter = {search: 'Example Bakery', date: {to: '2026-09-01'}};
		await agent.post(PREVIEW_PATH).send({filter, category: 'EATING_OUT'}).expect(404);
		await agent.patch(UPDATE_PATH).send({filter, category: 'EATING_OUT', scope: 'ALL'}).expect(404);

		expect(await snapshot()).toEqual(before);
	});

	it.each([
		['an empty selection', {transactionIds: [], category: 'EATING_OUT', scope: 'ALL'}, /transactionIds/],
		[
			'ids that are not ids',
			{transactionIds: ['not-a-uuid'], category: 'EATING_OUT', scope: 'ALL'},
			/transactionIds/,
		],
		['an unknown category', {transactionIds: [randomUUID()], category: 'NOT_A_CATEGORY', scope: 'ALL'}, /category/],
		['an unknown scope', {transactionIds: [randomUUID()], category: 'EATING_OUT', scope: 'SOME'}, /scope/],
		['no selection', {category: 'EATING_OUT', scope: 'ALL'}, /transactionIds or filter/],
		[
			'both ids and a filter',
			{transactionIds: [randomUUID()], filter: {}, category: 'EATING_OUT', scope: 'ALL'},
			/transactionIds or filter/,
		],
		[
			'a filter the list refuses',
			{filter: {categories: ['NOT_A_CATEGORY']}, category: 'EATING_OUT', scope: 'ALL'},
			/categories/,
		],
	])('rejects %s', async (_, body, message) => {
		const {agent} = await seed();
		expectValidationMessage(await agent.patch(UPDATE_PATH).send(body).expect(400), message);
	});
});
