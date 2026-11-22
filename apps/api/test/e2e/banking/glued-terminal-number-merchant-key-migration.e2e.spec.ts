import {getRepositoryToken} from '@nestjs/typeorm';
import {DataSource, Repository} from 'typeorm';

import {RefreshBankTransactionMerchantKeysForGluedTerminalNumbers20261122120000} from '@core/database/migrations/20261122120000-refresh-bank-transaction-merchant-keys-for-glued-terminal-numbers';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';

import {BankingFixtures, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

const card = (name: string, reference: string) =>
	`BEA, Google Pay ${name},PAS123 NR:${reference}, 06.01.26/22:30 EXAMPLETOWN`;

describe('RefreshBankTransactionMerchantKeysForGluedTerminalNumbers migration', () => {
	it('gives a card row with a glued store number its merchant key, keeps its category and writes nothing on a rerun', async () => {
		const app = getApp();
		const transactions: Repository<BankTransaction> = app.get(getRepositoryToken(BankTransaction));
		const fixtures = new BankingFixtures(app);
		const {bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		const [glued, spaced, shortCode] = await fixtures.createTransactions(bankAccount, [
			{
				...bookedRow('2026-01-06', '-5.99'),
				description: card('Example Burger00632', 'EX0001'),
				merchantKey: 'EXPENSE:example burger00632',
				category: 'EATING_OUT',
				categorySource: 'MANUAL',
			},
			{...bookedRow('2026-01-07', '-7.50'), description: card('Example Burger 01022', 'EX0002')},
			{...bookedRow('2026-01-08', '-12.00'), description: card('Example Clinic R10', 'EX0003')},
		]);

		const run = async () => {
			const queryRunner = app.get(DataSource).createQueryRunner();
			try {
				await new RefreshBankTransactionMerchantKeysForGluedTerminalNumbers20261122120000().up(queryRunner);
			} finally {
				await queryRunner.release();
			}
		};
		await run();
		// xmin changes on every write to a row, so an unchanged xmin proves the rerun left the rows alone.
		const rowVersions = () =>
			transactions.query(`SELECT "id", xmin::text FROM "bank_transactions" ORDER BY "id"`) as Promise<unknown[]>;
		const versionsAfterFirstRun = await rowVersions();
		await run();
		expect(await rowVersions()).toEqual(versionsAfterFirstRun);

		expect(await transactions.findOneByOrFail({id: glued.id})).toMatchObject({
			merchantKey: 'EXPENSE:example burger',
			category: 'EATING_OUT',
			categorySource: 'MANUAL',
		});
		expect(await transactions.findOneByOrFail({id: spaced.id})).toMatchObject({
			merchantKey: 'EXPENSE:example burger',
		});
		expect(await transactions.findOneByOrFail({id: shortCode.id})).toMatchObject({
			merchantKey: 'EXPENSE:example clinic r10',
		});
	});
});
