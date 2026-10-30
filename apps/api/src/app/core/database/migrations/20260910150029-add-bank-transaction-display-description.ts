import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

import {getBankTransactionDisplayDescription} from '../../../modules/banking/bank-transaction-display';

type BankTransactionDisplayRow = {
	id: string;
	description: string | null;
	counterpartyName: string | null;
};

export class AddBankTransactionDisplayDescription20260910150029 implements MigrationInterface {
	name = 'AddBankTransactionDisplayDescription20260910150029';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;

		if (!(await queryRunner.hasColumn('bank_transactions', 'displayDescription'))) {
			await queryRunner.addColumn(
				'bank_transactions',
				new TableColumn({
					name: 'displayDescription',
					type: 'varchar',
					length: '500',
					isNullable: true,
				}),
			);
		}

		const transactions = (await queryRunner.query(
			'SELECT "id", "description", "counterpartyName" FROM "bank_transactions"',
		)) as BankTransactionDisplayRow[];

		for (const transaction of transactions) {
			const displayDescription = getBankTransactionDisplayDescription(transaction);
			await queryRunner.query('UPDATE "bank_transactions" SET "displayDescription" = $1 WHERE "id" = $2', [
				displayDescription,
				transaction.id,
			]);
		}

		await queryRunner.changeColumn(
			'bank_transactions',
			'displayDescription',
			new TableColumn({
				name: 'displayDescription',
				type: 'varchar',
				length: '500',
				isNullable: false,
			}),
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		if (await queryRunner.hasColumn('bank_transactions', 'displayDescription')) {
			await queryRunner.dropColumn('bank_transactions', 'displayDescription');
		}
	}
}
