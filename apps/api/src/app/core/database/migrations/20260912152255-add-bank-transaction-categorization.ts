import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

const CATEGORIZATION_COLUMNS = [
	new TableColumn({
		name: 'category',
		type: 'varchar',
		length: '32',
		isNullable: true,
	}),
	new TableColumn({
		name: 'categoryStatus',
		type: 'varchar',
		length: '16',
		default: "'PENDING'",
		isNullable: false,
	}),
	new TableColumn({
		name: 'categorySource',
		type: 'varchar',
		length: '16',
		isNullable: true,
	}),
	new TableColumn({
		name: 'categoryConfidence',
		type: 'numeric',
		precision: 4,
		scale: 3,
		isNullable: true,
	}),
	new TableColumn({
		name: 'categoryInputHash',
		type: 'varchar',
		length: '64',
		isNullable: true,
	}),
	new TableColumn({
		name: 'categoryAppliedInputHash',
		type: 'varchar',
		length: '64',
		isNullable: true,
	}),
	new TableColumn({
		name: 'categoryProvider',
		type: 'varchar',
		length: '32',
		isNullable: true,
	}),
	new TableColumn({
		name: 'categoryModel',
		type: 'varchar',
		length: '128',
		isNullable: true,
	}),
	new TableColumn({
		name: 'categoryPromptVersion',
		type: 'varchar',
		length: '64',
		isNullable: true,
	}),
	new TableColumn({
		name: 'categoryUpdatedAt',
		type: 'timestamptz',
		isNullable: true,
	}),
	new TableColumn({
		name: 'categoryLastError',
		type: 'text',
		isNullable: true,
	}),
];

export class AddBankTransactionCategorization20260912152255 implements MigrationInterface {
	name = 'AddBankTransactionCategorization20260912152255';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;

		for (const column of CATEGORIZATION_COLUMNS) {
			if (!(await queryRunner.hasColumn('bank_transactions', column.name))) {
				await queryRunner.addColumn('bank_transactions', column);
			}
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;

		for (const column of [...CATEGORIZATION_COLUMNS].reverse()) {
			if (await queryRunner.hasColumn('bank_transactions', column.name)) {
				await queryRunner.dropColumn('bank_transactions', column.name);
			}
		}
	}
}
