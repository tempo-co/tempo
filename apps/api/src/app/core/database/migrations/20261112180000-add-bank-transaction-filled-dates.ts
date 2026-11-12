import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

const COLUMNS = ['bookingDateFilled', 'valueDateFilled'] as const;

export class AddBankTransactionFilledDates20261112180000 implements MigrationInterface {
	name = 'AddBankTransactionFilledDates20261112180000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		// Stored rows count as provider dates: only a pending row's next booking reads the flags, and the next sync
		// writes them for every row it returns.
		for (const name of COLUMNS) {
			if (await queryRunner.hasColumn('bank_transactions', name)) continue;
			await queryRunner.addColumn(
				'bank_transactions',
				new TableColumn({name, type: 'boolean', isNullable: false, default: false}),
			);
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		for (const name of COLUMNS) {
			if (await queryRunner.hasColumn('bank_transactions', name)) {
				await queryRunner.dropColumn('bank_transactions', name);
			}
		}
	}
}
