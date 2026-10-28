import {DataSource, DeepPartial} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {Account} from '@modules/account/account.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {RecurringContinuationUnlink} from '@modules/banking/recurring/recurring-continuation-unlink.entity';
import {RecurringSeriesHide} from '@modules/banking/recurring/recurring-series-hide.entity';

import {BankingFixtures, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {
	SESSION_TEST_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';

const MIGRATION_NAME = 'RefreshProcessorCollectedBusinessIdentity20261026120000';
const PROCESSOR = 'Adyen N.V.';
const BUSINESS = 'Example Fitness B.V.';

function collectedDescription(business = BUSINESS) {
	return `SEPA Incasso algemeen doorlopend Naam: ${PROCESSOR} Machtiging: example-mandate Omschrijving: ${business} Exa\n mple City: example-invoice Kenmerk: example-reference`;
}

describe('Processor-collected business identity', () => {
	it('refreshes only evidenced derived identity, preserving ledger data and owner decisions through a repeatable migration cycle', async () => {
		const app = getApp();
		const ds = app.get(DataSource);
		const fixtures = new BankingFixtures(app);
		const owner = await ds.getRepository(Account).findOneByOrFail({email: VERIFIED_ACCOUNT_EMAIL});
		const connection = await fixtures.createConnection(owner, {aspspName: 'Example Bank'});
		const bank = await fixtures.createBankAccount(connection);
		const syncRun = await fixtures.createSyncRun(connection);
		await fixtures.createBalances(bank, syncRun, [{amount: '123.00'}]);
		const base = {
			...bookedRow('2026-05-03', '-12.00'),
			description: collectedDescription(),
			counterpartyName: PROCESSOR,
			merchantKey: null,
			displayDescription: PROCESSOR,
			transactionType: 'DIRECT_DEBIT',
		} satisfies DeepPartial<BankTransaction>;
		const targets = await fixtures.createTransactions(bank, [
			{
				...base,
				categorySource: 'MANUAL',
				categoryInputHash: 'example-current-hash',
				categoryAppliedInputHash: 'example-applied-hash',
				categoryUpdatedAt: new Date('2026-05-04T00:00:00Z'),
				ownTransferOverride: 'UNMARKED',
				providerTransactionId: 'example-provider-id',
				entryReference: 'example-entry-reference',
				remittanceInformation: 'Example retained source remittance',
			},
			{...base, counterpartyName: null},
			{...base, description: collectedDescription().replace('SEPA Incasso', ' \tsepa\n INCASSO')},
			{...base, merchantKey: 'EXPENSE:example fitness'},
			{...base, displayDescription: BUSINESS},
			{
				...base,
				...bookedRow('2026-05-04', '12.00'),
				categorySource: 'HISTORY',
			},
		]);
		const alreadyCurrent = await fixtures.createTransaction(bank, {
			...base,
			merchantKey: 'EXPENSE:example fitness',
			displayDescription: BUSINESS,
		});
		await fixtures.createTransactions(bank, [
			{...base, description: 'Example plain note', counterpartyName: 'Example Shop'},
			{...base, description: collectedDescription().replace('SEPA Incasso', 'SEPA iDEAL')},
			{...base, description: collectedDescription().replace('SEPA Incasso', 'Unstructured note')},
			{...base, counterpartyName: 'Example Actual Business'},
			{...base, description: collectedDescription().replace(`Naam: ${PROCESSOR}`, 'Naam: Example Business')},
			{...base, description: collectedDescription().replace(`Naam: ${PROCESSOR} `, '')},
			{...base, description: collectedDescription('Example Fitness')},
			{...base, description: collectedDescription('Invoice Example Fitness B.V.')},
			{...base, description: collectedDescription('Example Fitness B.V. and Example Music B.V.')},
			{...base, description: collectedDescription('Example Fitness B.V., Example Music B.V.')},
			{...base, description: collectedDescription('Adyen B.V.')},
			{...base, description: null},
		]);
		const hides = ds.getRepository(RecurringSeriesHide);
		const unlinks = ds.getRepository(RecurringContinuationUnlink);
		const hide = await hides.save({
			accountId: owner.id,
			seriesKey: 'example-hidden-series',
			transactionIds: [targets[0].id],
		});
		const unlink = await unlinks.save({
			accountId: owner.id,
			olderTransactionIds: [targets[0].id],
			newerTransactionIds: [targets[1].id],
		});
		const runner = ds.createQueryRunner();
		await runner.startTransaction();
		try {
			const targetIds = targets.map(({id}) => id);
			const derived = () =>
				runner.query(
					'SELECT id, "merchantKey", "displayDescription" FROM bank_transactions WHERE id = ANY($1::uuid[]) ORDER BY id',
					[targetIds],
				);
			const source = () =>
				runner.query(
					`SELECT to_jsonb(t) - 'merchantKey' - 'displayDescription' AS state FROM bank_transactions t ORDER BY id`,
				);
			const unchangedRows = () =>
				runner.query(
					'SELECT to_jsonb(t) AS state, ctid::text AS tuple FROM bank_transactions t WHERE NOT (id = ANY($1::uuid[])) ORDER BY id',
					[targetIds],
				);
			const physicalRows = () =>
				runner.query('SELECT to_jsonb(t) AS state, ctid::text AS tuple FROM bank_transactions t ORDER BY id');
			const unrelatedTables = async () => {
				const tables: Array<{tablename: string}> = await runner.query(
					"SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'bank_transactions' ORDER BY tablename",
				);
				const states = [];
				for (const {tablename} of tables) {
					const [state] = await runner.query(
						`SELECT COUNT(*)::int AS count, md5(COALESCE(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) AS hash FROM ${ds.driver.escape(tablename)} t`,
					);
					states.push({tablename, ...state});
				}
				return states;
			};
			const before = {source: await source(), unchanged: await unchangedRows(), tables: await unrelatedTables()};
			const migration = ds.migrations.find(({name}) => name === MIGRATION_NAME);
			await migration?.up(runner);
			expect(await derived()).toEqual(
				targets
					.map(({id, creditDebitIndicator}) => ({
						id,
						merchantKey: `${creditDebitIndicator === 'CRDT' ? 'INCOME' : 'EXPENSE'}:example fitness`,
						displayDescription: BUSINESS,
					}))
					.sort((a, b) => a.id.localeCompare(b.id)),
			);
			expect(migration).toBeDefined();
			expect(await source()).toEqual(before.source);
			expect(await unchangedRows()).toEqual(before.unchanged);
			expect(await unrelatedTables()).toEqual(before.tables);
			const once = await physicalRows();
			await migration!.up(runner);
			expect(await physicalRows()).toEqual(once);
			await migration!.down(runner);
			expect(await physicalRows()).toEqual(once);
			await migration!.up(runner);
			expect(await physicalRows()).toEqual(once);
			expect(await unrelatedTables()).toEqual(before.tables);
			// The refreshed schema remains writable through TypeORM.
			await runner.manager
				.getRepository(BankTransaction)
				.update(alreadyCurrent.id, {referenceNumber: 'example-after-up'});
			expect(
				(await runner.manager.getRepository(BankTransaction).findOneByOrFail({id: alreadyCurrent.id}))
					.merchantKey,
			).toBe('EXPENSE:example fitness');
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
			await hides.delete(hide.id);
			await unlinks.delete(unlink.id);
			await fixtures.connections.delete(connection.id);
		}
	});

	it('uses backfilled and fresh business identity for separate recurring histories and owner-scoped category previews', async () => {
		const app = getApp();
		const config = app.get(ConfigurationService);
		expect(config.get('BANKING_INTEGRATION_ENABLED')).toBe(false);
		expect(config.get('AI_CATEGORIZATION_ENABLED')).toBe(false);
		const ds = app.get(DataSource);
		const fixtures = new BankingFixtures(app);
		const owner = await ds.getRepository(Account).findOneByOrFail({email: VERIFIED_ACCOUNT_EMAIL});
		const other = await ds.getRepository(Account).findOneByOrFail({email: SESSION_TEST_ACCOUNT_EMAIL});
		const agent = await loginAgent(app.getHttpServer(), VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		const connection = await fixtures.createConnection(owner, {aspspName: 'Example Bank'});
		const otherConnection = await fixtures.createConnection(other, {aspspName: 'Example Other Bank'});
		const bank = await fixtures.createBankAccount(connection);
		const otherBank = await fixtures.createBankAccount(otherConnection);
		const businesses = [BUSINESS, 'Example Music B.V.'];
		const rawRow = (business: string, month: string) =>
			bookedRow(`${month}-03`, '-12.00', {
				description: collectedDescription(business),
				counterpartyName: PROCESSOR,
				transactionType: 'DIRECT_DEBIT',
				category: 'SUBSCRIPTIONS',
				categoryInputHash: 'example-input-hash',
			});
		try {
			const histories = await Promise.all(
				businesses.map((business) =>
					fixtures.createTransactions(
						bank,
						['2026-05', '2026-06', '2026-07', '2026-08'].map((month, index) => ({
							...rawRow(business, month),
							counterpartyName: index % 2 ? null : PROCESSOR,
							categorySource: index === 0 ? 'MANUAL' : 'AI',
							merchantKey: null,
							displayDescription: PROCESSOR,
						})),
					),
				),
			);
			await fixtures.createTransaction(otherBank, rawRow(BUSINESS, '2026-08'));
			const readSeries = async () =>
				(await agent.get('/recurring-series').query({asOf: '2026-09-04'}).expect(200)).body.expenses
					.series as Array<{
					key: string;
					name: string;
					cadence: string;
					transactionCount: number;
				}>;
			// Cache the legacy empty result before the migration changes the stored candidate identity.
			expect(await readSeries()).toEqual([]);
			const migration = ds.migrations.find(({name}) => name === MIGRATION_NAME);
			expect(migration).toBeDefined();
			const runner = ds.createQueryRunner();
			try {
				await migration!.up(runner);
			} finally {
				await runner.release();
			}
			expect(await readSeries()).toEqual(
				expect.arrayContaining(
					businesses.map((name) => expect.objectContaining({name, cadence: 'MONTHLY', transactionCount: 4})),
				),
			);
			// Fresh raw text goes through the same derivation boundary used by sync, without pre-filled identity.
			const fresh = await Promise.all(
				businesses.map((business) => fixtures.createTransaction(bank, rawRow(business, '2026-09'))),
			);
			expect(fresh.map(({merchantKey, displayDescription}) => ({merchantKey, displayDescription}))).toEqual([
				{merchantKey: 'EXPENSE:example fitness', displayDescription: BUSINESS},
				{merchantKey: 'EXPENSE:example music', displayDescription: businesses[1]},
			]);
			const series = await readSeries();
			expect(series).toHaveLength(2);
			for (const [index, name] of businesses.entries()) {
				const entry = series.find((entry) => entry.name === name)!;
				expect(entry).toMatchObject({name, cadence: 'MONTHLY', transactionCount: 5});
				const expectedIds = [...histories[index], fresh[index]].map(({id}) => id).sort();
				const {body: drill} = await agent
					.get('/bank-transactions')
					.query({filter: {recurringSeriesKey: entry.key}, pagination: {pageIndex: 0, pageSize: 50}})
					.expect(200);
				expect(drill.transactions.map(({id}: {id: string}) => id).sort()).toEqual(expectedIds);
				const {body: detail} = await agent.get(`/bank-transactions/${histories[index][0].id}`).expect(200);
				expect(detail).toMatchObject({
					description: collectedDescription(name),
					counterpartyName: PROCESSOR,
					displayDescription: name,
					category: 'SUBSCRIPTIONS',
					categorySource: 'MANUAL',
				});
				const {body: impact} = await agent
					.get(`/bank-transactions/${histories[index][0].id}/category-impact`)
					.query({category: 'EDUCATION'})
					.expect(200);
				expect(impact).toMatchObject({action: 'APPLY', category: 'EDUCATION', total: 4});
				expect(impact.transactions.map(({id}: {id: string}) => id).sort()).toEqual(
					expectedIds.filter((id) => id !== histories[index][0].id),
				);
			}
		} finally {
			await fixtures.connections.delete([connection.id, otherConnection.id]);
		}
	});
});
