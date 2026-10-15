import {INestApplication} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Server} from 'node:net';
import TestAgent from 'supertest/lib/agent';
import {DeepPartial} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';

import {BankingFixtures, CURRENCY_EXCHANGE_EVENT, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createVerifiedAccount, expectValidationMessage} from '../../utils/auth-utils';

const EXAMPLE_SHOP = {description: 'Example Shop', counterpartyName: 'Example Shop'};
const EXAMPLE_CAFE = {description: 'Example Cafe', counterpartyName: 'Example Cafe'};

/** A row automation has categorized, as sync leaves it: with an input hash. */
function categorizedRow(bookingDate: string | null, amount: string, overrides: DeepPartial<BankTransaction> = {}) {
	return bookedRow(bookingDate, amount, {...EXAMPLE_SHOP, categoryInputHash: `hash-${randomUUID()}`, ...overrides});
}

describe('Bank transaction category impact', () => {
	let app: INestApplication<Server>;
	let fixtures: BankingFixtures;
	let ownerAgent: TestAgent;
	let otherAgent: TestAgent;
	let rows: Record<string, BankTransaction>;

	const reload = async (name: string) => fixtures.transactions.findOneByOrFail({id: rows[name].id});
	const impactPath = (name: string, category: string) =>
		`/bank-transactions/${rows[name].id}/category-impact?category=${category}`;

	beforeAll(async () => {
		app = getApp();
		const httpServer = app.getHttpServer();
		const config = app.get(ConfigurationService);
		expect(config.get('AI_CATEGORIZATION_ENABLED')).toBe(false);
		fixtures = new BankingFixtures(app);

		const owner = await createVerifiedAccount(httpServer, config.get('EMAIL_UI_URL'));
		const other = await createVerifiedAccount(httpServer, config.get('EMAIL_UI_URL'));
		ownerAgent = owner.agent;
		otherAgent = other.agent;

		const ownerAccount = await fixtures.createBankAccount(await fixtures.createConnection({id: owner.id}));
		const otherAccount = await fixtures.createBankAccount(await fixtures.createConnection({id: other.id}));

		const create = async (bankAccount: BankAccount, values: DeepPartial<BankTransaction>) =>
			fixtures.createTransaction(bankAccount, values);
		rows = {
			corrected: await create(ownerAccount, categorizedRow('2026-09-10', '-10.00')),
			// Pending: no booking date yet, but the newest by transaction date, so it is listed first.
			pendingSibling: await create(
				ownerAccount,
				categorizedRow(null, '-9.00', {transactionDate: '2026-09-11', transactionStatus: 'PDNG'}),
			),
			aiSibling: await create(ownerAccount, categorizedRow('2026-09-08', '-11.00')),
			historySibling: await create(
				ownerAccount,
				categorizedRow('2026-09-09', '-12.00', {category: 'FOOD_AND_DRINK', categorySource: 'HISTORY'}),
			),
			failedSibling: await create(
				ownerAccount,
				categorizedRow('2026-09-07', '-13.00', {
					category: null,
					categoryStatus: 'FAILED',
					categorySource: null,
				}),
			),
			// A manual choice that agrees with the correction, so the follow-up applies TRAVEL.
			manual: await create(
				ownerAccount,
				categorizedRow('2026-09-06', '-14.00', {category: 'TRAVEL', categorySource: 'MANUAL'}),
			),
			alreadyApplied: await create(
				ownerAccount,
				categorizedRow('2026-09-05', '-15.00', {category: 'TRAVEL', categorySource: 'HISTORY'}),
			),
			processing: await create(
				ownerAccount,
				categorizedRow('2026-09-04', '-16.00', {categoryStatus: 'PROCESSING'}),
			),
			ownTransfer: await create(
				ownerAccount,
				categorizedRow('2026-09-03', '-17.00', {ownTransferEvidence: 'IBAN'}),
			),
			exchange: await create(ownerAccount, categorizedRow('2026-09-02', '-18.00', CURRENCY_EXCHANGE_EVENT)),
			income: await create(ownerAccount, categorizedRow('2026-09-01', '19.00')),
			otherOwner: await create(otherAccount, categorizedRow('2026-09-08', '-20.00')),
			cafeCorrected: await create(ownerAccount, categorizedRow('2026-09-10', '-3.00', EXAMPLE_CAFE)),
			cafeSibling: await create(ownerAccount, categorizedRow('2026-09-09', '-4.00', EXAMPLE_CAFE)),
		};
		expect(rows.income.merchantKey).not.toBe(rows.corrected.merchantKey);
		expect(rows.otherOwner.merchantKey).toBe(rows.corrected.merchantKey);
	});

	it('lists exactly the rows the correction would change, without saving anything', async () => {
		const response = await ownerAgent.get(impactPath('corrected', 'TRAVEL')).expect(200);

		expect(response.body).toEqual({
			action: 'APPLY',
			category: 'TRAVEL',
			total: 4,
			transactions: [
				expect.objectContaining({id: rows.pendingSibling.id, transactionDate: '2026-09-11', bookingDate: null}),
				{
					id: rows.historySibling.id,
					transactionDate: null,
					bookingDate: '2026-09-09',
					displayDescription: 'Example Shop',
					amount: '-12.00000000',
					currency: 'EUR',
					category: 'FOOD_AND_DRINK',
					categoryStatus: 'COMPLETED',
					categorySource: 'HISTORY',
				},
				expect.objectContaining({id: rows.aiSibling.id, category: 'SHOPPING', categorySource: 'AI'}),
				expect.objectContaining({id: rows.failedSibling.id, category: null, categoryStatus: 'FAILED'}),
			],
		});
		expect(await reload('corrected')).toMatchObject({category: 'SHOPPING', categorySource: 'AI'});
	});

	it('lists nothing when the correction would leave the owner without one consistent choice', async () => {
		// The owner's other manual choice is TRAVEL, so SHOPPING makes them disagree; with AI off nothing is rechecked.
		const response = await ownerAgent.get(impactPath('corrected', 'SHOPPING')).expect(200);

		expect(response.body).toEqual({action: null, category: null, total: 0, transactions: []});
	});

	it('rejects other owners and unknown categories', async () => {
		await otherAgent.get(impactPath('corrected', 'TRAVEL')).expect(404);
		const response = await ownerAgent.get(impactPath('corrected', 'NOT_A_CATEGORY')).expect(400);
		expectValidationMessage(response, /category/);
	});

	it('changes only the corrected row when no other row is selected', async () => {
		await ownerAgent
			.patch(`/bank-transactions/${rows.cafeCorrected.id}/category`)
			.send({category: 'FOOD_AND_DRINK'})
			.expect(200);

		expect(await reload('cafeCorrected')).toMatchObject({category: 'FOOD_AND_DRINK', categorySource: 'MANUAL'});
		expect(await reload('cafeSibling')).toMatchObject({category: 'SHOPPING', categorySource: 'AI'});
		// Not remembered: the sibling is offered again next time.
		const response = await ownerAgent.get(impactPath('cafeCorrected', 'FOOD_AND_DRINK')).expect(200);
		expect(response.body.transactions.map(({id}: {id: string}) => id)).toEqual([rows.cafeSibling.id]);
	});

	it('rejects a selection that is not a list of ids', async () => {
		const response = await ownerAgent
			.patch(`/bank-transactions/${rows.corrected.id}/category`)
			.send({category: 'TRAVEL', applyToTransactionIds: ['not-a-uuid']})
			.expect(400);
		expectValidationMessage(response, /applyToTransactionIds/);
		expect(await reload('corrected')).toMatchObject({category: 'SHOPPING', categorySource: 'AI'});
	});

	it('applies the correction only to selected rows the preview would list', async () => {
		const ineligible = [
			'manual',
			'alreadyApplied',
			'processing',
			'ownTransfer',
			'exchange',
			'income',
			'otherOwner',
			'cafeSibling',
		];
		const before = new Map(await Promise.all(ineligible.map(async (name) => [name, await reload(name)] as const)));

		await ownerAgent
			.patch(`/bank-transactions/${rows.corrected.id}/category`)
			.send({
				category: 'TRAVEL',
				applyToTransactionIds: [rows.aiSibling.id, ...ineligible.map((name) => rows[name].id), randomUUID()],
			})
			.expect(200);

		expect(await reload('corrected')).toMatchObject({category: 'TRAVEL', categorySource: 'MANUAL'});
		const applied = await reload('aiSibling');
		expect(applied).toMatchObject({category: 'TRAVEL', categorySource: 'HISTORY', categoryStatus: 'COMPLETED'});
		expect(applied.categoryAppliedInputHash).toBe(applied.categoryInputHash);
		// Eligible but left unticked.
		expect(await reload('historySibling')).toMatchObject({category: 'FOOD_AND_DRINK', categorySource: 'HISTORY'});
		expect(await reload('failedSibling')).toMatchObject({category: null, categoryStatus: 'FAILED'});
		expect(await reload('pendingSibling')).toMatchObject({category: 'SHOPPING', categorySource: 'AI'});
		for (const name of ineligible) {
			const row = await reload(name);
			expect({name, ...pickCategory(row)}).toEqual({name, ...pickCategory(before.get(name)!)});
		}
	});
});

function pickCategory({category, categorySource, categoryStatus, categoryUpdatedAt}: BankTransaction) {
	return {category, categorySource, categoryStatus, categoryUpdatedAt};
}
