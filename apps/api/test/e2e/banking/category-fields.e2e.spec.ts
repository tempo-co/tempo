import {INestApplication} from '@nestjs/common';
import {DeepPartial} from 'typeorm';

import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {
	claimableCondition,
	counterpartyPaymentSql,
	isCounterpartyPayment,
	isModelCategorizable,
	modelCategorizableSql,
} from '@modules/banking/categorization/category-fields';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

/** Each row with whether it is a counterparty payment, whether automation may categorize it, and whether a worker may claim it. */
const ROWS: Array<{
	name: string;
	values: DeepPartial<BankTransaction>;
	counterparty: boolean;
	categorizable: boolean;
	claimable: boolean;
}> = [
	{
		name: 'completed by the model',
		values: {category: 'SHOPPING', categoryStatus: 'COMPLETED', categorySource: 'AI'},
		counterparty: true,
		categorizable: true,
		claimable: false,
	},
	{
		name: 'filled from history',
		values: {category: 'SHOPPING', categoryStatus: 'COMPLETED', categorySource: 'HISTORY'},
		counterparty: true,
		categorizable: true,
		claimable: false,
	},
	{
		name: 'pending',
		values: {categoryStatus: 'PENDING'},
		counterparty: true,
		categorizable: true,
		claimable: true,
	},
	{
		name: 'failed',
		values: {categoryStatus: 'FAILED', categoryLastError: 'Transaction categorization failed.'},
		counterparty: true,
		categorizable: true,
		claimable: true,
	},
	{
		name: 'held by a worker that stopped',
		values: {categoryStatus: 'PROCESSING', categoryUpdatedAt: minutesAgo(16)},
		counterparty: true,
		categorizable: true,
		claimable: true,
	},
	{
		name: 'held by a working worker',
		values: {categoryStatus: 'PROCESSING', categoryUpdatedAt: minutesAgo(1)},
		counterparty: true,
		categorizable: true,
		claimable: false,
	},
	{
		name: 'set by the owner',
		values: {category: 'TRAVEL', categoryStatus: 'COMPLETED', categorySource: 'MANUAL'},
		counterparty: true,
		categorizable: false,
		claimable: false,
	},
	{
		name: 'pending, then set by the owner',
		values: {category: 'TRAVEL', categoryStatus: 'PENDING', categorySource: 'MANUAL'},
		counterparty: true,
		categorizable: false,
		claimable: true,
	},
	{
		name: 'an own transfer',
		values: {ownTransferEvidence: 'IBAN', category: 'TRANSFER_OUT', categoryStatus: 'COMPLETED'},
		counterparty: false,
		categorizable: false,
		claimable: false,
	},
	{
		name: 'an own transfer still pending',
		values: {ownTransferEvidence: 'NAME', categoryStatus: 'PENDING'},
		counterparty: false,
		categorizable: false,
		claimable: true,
	},
	{
		name: 'a currency exchange',
		values: {
			financialEventType: 'CURRENCY_EXCHANGE',
			financialEventSource: 'RULE',
			categoryStatus: 'NOT_APPLICABLE',
		},
		counterparty: false,
		categorizable: false,
		claimable: false,
	},
	{
		name: 'a currency exchange the owner categorized',
		values: {
			financialEventType: 'CURRENCY_EXCHANGE',
			financialEventSource: 'RULE',
			category: 'TRAVEL',
			categoryStatus: 'COMPLETED',
			categorySource: 'MANUAL',
		},
		counterparty: false,
		categorizable: false,
		claimable: false,
	},
];

describe('Category eligibility', () => {
	let app: INestApplication;

	beforeAll(() => {
		app = getApp();
	});

	it('decides the same rows in code and in SQL', async () => {
		const fixtures = new BankingFixtures(app);
		const {bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		const created = await fixtures.createTransactions(
			bankAccount,
			ROWS.map(({name, values}) => ({description: `Example ${name}`, amount: '-4.20', ...values})),
		);
		const stored = await fixtures.transactions.findBy(created.map(({id}) => ({id})));
		const byId = new Map(stored.map((row) => [row.id, row]));

		const selectIds = async (sql: string, parameters: Record<string, unknown> = {}) => {
			const rows = await fixtures.transactions
				.createQueryBuilder('transaction')
				.select('transaction.id', 'id')
				.where('transaction."bankAccountId" = :bankAccountId', {bankAccountId: bankAccount.id})
				.andWhere(sql, parameters)
				.getRawMany<{id: string}>();
			return new Set(rows.map(({id}) => id));
		};
		const counterpartyIds = await selectIds(counterpartyPaymentSql('transaction'));
		const categorizableIds = await selectIds(modelCategorizableSql('transaction'));
		const claimable = claimableCondition('transaction');
		const claimableIds = await selectIds(claimable.sql, claimable.parameters);

		const decisions = ROWS.map(({name}, index) => {
			const row = byId.get(created[index].id)!;
			return {
				name,
				counterparty: isCounterpartyPayment(row),
				counterpartySql: counterpartyIds.has(row.id),
				categorizable: isModelCategorizable(row),
				categorizableSql: categorizableIds.has(row.id),
				claimable: claimableIds.has(row.id),
			};
		});
		expect(decisions).toEqual(
			ROWS.map(({name, counterparty, categorizable, claimable}) => ({
				name,
				counterparty,
				counterpartySql: counterparty,
				categorizable,
				categorizableSql: categorizable,
				claimable,
			})),
		);
	});
});
