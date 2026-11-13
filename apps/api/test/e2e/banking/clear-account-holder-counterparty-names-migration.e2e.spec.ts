import {DataSource} from 'typeorm';

import {BankingFixtures, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

const MIGRATION_NAME = 'ClearAccountHolderCounterpartyNames20261113120000';
const HOLDER = 'Example Account Holder';
const REWRITTEN_COLUMNS = ['counterpartyName', 'description', 'displayDescription', 'merchantKey'] as const;

describe('ClearAccountHolderCounterpartyNames migration', () => {
	it('clears holder names and copied descriptions the old client stored, re-derives identity and keeps everything else', async () => {
		const app = getApp();
		const ds = app.get(DataSource);
		const fixtures = new BankingFixtures(app);
		const {connection} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		const [bank, otherBank] = await fixtures.createBankAccounts(connection, [
			{name: HOLDER},
			{name: 'Sample Other Person'},
		]);
		const debit = bookedRow('2026-08-20', '-5.00');
		const holderKey = 'EXPENSE:example account holder';
		const [fee, salutation, topUp, undirected, copied] = await fixtures.createTransactions(bank, [
			{
				...debit,
				counterpartyName: HOLDER,
				description: 'Example account fee',
				bankTransactionDescription: 'Example account fee',
				displayDescription: 'Example account fee',
				merchantKey: holderKey,
				category: 'FEES',
				categorySource: 'MANUAL',
				categoryInputHash: 'example-input-hash',
				categoryAppliedInputHash: 'example-input-hash',
			},
			{
				...debit,
				counterpartyName: 'MR EXAMPLE ACCOUNT HOLDER',
				description: 'MR EXAMPLE ACCOUNT HOLDER',
				displayDescription: 'MR EXAMPLE ACCOUNT HOLDER',
				merchantKey: 'EXPENSE:mr example account holder',
			},
			{
				...bookedRow('2026-08-20', '20.00'),
				counterpartyName: HOLDER,
				description: 'Example top-up',
				remittanceInformation: 'Example top-up',
				displayDescription: 'Example top-up',
				merchantKey: 'INCOME:example account holder',
			},
			{
				...debit,
				creditDebitIndicator: null,
				counterpartyName: 'Example Shop',
				description: 'Example note',
				displayDescription: 'Example note',
				merchantKey: 'UNKNOWN:example shop',
			},
			{
				...debit,
				counterpartyName: 'Example Shop',
				description: 'Example Shop',
				displayDescription: 'Example Shop',
				merchantKey: 'EXPENSE:example shop',
			},
		]);
		const kept = [
			...(await fixtures.createTransactions(bank, [
				// For an own transfer the account holder is the real other party.
				{...debit, counterpartyName: HOLDER, ownTransferEvidence: 'IBAN', displayDescription: HOLDER},
				{
					...debit,
					counterpartyName: 'Example Shop',
					description: 'Example Shop',
					remittanceInformation: 'Example Shop',
					displayDescription: 'Example Shop',
				},
				{...debit, counterpartyName: 'Example Holderson', description: 'Example payment'},
				{...debit, counterpartyName: null, description: 'Example card payment'},
			])),
			// Another account's holder name is a payment to that person from this account.
			await fixtures.createTransaction(otherBank, {
				...debit,
				counterpartyName: HOLDER,
				displayDescription: HOLDER,
			}),
		];
		const targets = [fee, salutation, topUp, undirected, copied];

		const runner = ds.createQueryRunner();
		await runner.startTransaction();
		try {
			const rewritten = async () =>
				Object.fromEntries(
					(
						await runner.query(
							`SELECT id, ${REWRITTEN_COLUMNS.map((column) => `"${column}"`).join(', ')}
							FROM bank_transactions WHERE id = ANY($1::uuid[])`,
							[targets.map(({id}) => id)],
						)
					).map(({id, ...columns}: {id: string}) => [id, columns]),
				);
			const otherColumns = () =>
				runner.query(
					`SELECT id, to_jsonb(t) ${REWRITTEN_COLUMNS.map((column) => `- '${column}'`).join(' ')} AS state
					FROM bank_transactions t ORDER BY id`,
				);
			const untouchedRows = () =>
				runner.query(
					'SELECT to_jsonb(t) AS state, ctid::text AS tuple FROM bank_transactions t WHERE NOT (id = ANY($1::uuid[])) ORDER BY id',
					[targets.map(({id}) => id)],
				);
			const physicalRows = () =>
				runner.query('SELECT to_jsonb(t) AS state, ctid::text AS tuple FROM bank_transactions t ORDER BY id');
			const before = {other: await otherColumns(), untouched: await untouchedRows()};
			const migration = ds.migrations.find(({name}) => name === MIGRATION_NAME);
			expect(migration).toBeDefined();

			await migration!.up(runner);

			expect(await rewritten()).toEqual({
				[fee.id]: {
					counterpartyName: null,
					description: 'Example account fee',
					displayDescription: 'Example account fee',
					merchantKey: 'EXPENSE:example account fee',
				},
				[salutation.id]: {
					counterpartyName: null,
					description: null,
					displayDescription: 'Transaction',
					merchantKey: null,
				},
				[topUp.id]: {
					counterpartyName: null,
					description: 'Example top-up',
					displayDescription: 'Example top-up',
					merchantKey: 'INCOME:example top-up',
				},
				[undirected.id]: {
					counterpartyName: null,
					description: 'Example note',
					displayDescription: 'Example note',
					merchantKey: 'UNKNOWN:example note',
				},
				[copied.id]: {
					counterpartyName: 'Example Shop',
					description: null,
					displayDescription: 'Example Shop',
					merchantKey: 'EXPENSE:example shop',
				},
			});
			// Categories (the manual one included), amounts, dates and identity keys stay as they were.
			expect(await otherColumns()).toEqual(before.other);
			expect(await untouchedRows()).toEqual(before.untouched);
			expect(before.untouched.map(({state}: {state: {id: string}}) => state.id)).toEqual(
				expect.arrayContaining(kept.map(({id}) => id)),
			);

			const once = await physicalRows();
			await migration!.up(runner);
			expect(await physicalRows()).toEqual(once);
			await migration!.down(runner);
			expect(await physicalRows()).toEqual(once);
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
			await fixtures.connections.delete(connection.id);
		}
	});
});
