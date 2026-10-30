import {MigrationInterface, QueryRunner, Table, TableColumn, TableIndex} from 'typeorm';

const FX_RATE_TABLE = 'bank_transaction_fx_rates';
const FX_RATE_INDEX = 'idx_bank_transaction_fx_rates_currency_date';

export class AddCurrencyAwareBankTransactionSorting20260919140000 implements MigrationInterface {
	name = 'AddCurrencyAwareBankTransactionSorting20260919140000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (await queryRunner.hasTable('accounts')) {
			if (!(await queryRunner.hasColumn('accounts', 'baseCurrency'))) {
				await queryRunner.addColumn(
					'accounts',
					new TableColumn({name: 'baseCurrency', type: 'varchar', length: '3', isNullable: true}),
				);
			}
		}

		if (await queryRunner.hasTable('bank_transactions')) {
			if (!(await queryRunner.hasColumn('bank_transactions', 'amountInBaseCurrency'))) {
				await queryRunner.addColumn(
					'bank_transactions',
					new TableColumn({
						name: 'amountInBaseCurrency',
						type: 'numeric',
						precision: 30,
						scale: 12,
						isNullable: true,
					}),
				);
			}
		}

		if (!(await queryRunner.hasTable(FX_RATE_TABLE))) {
			await queryRunner.createTable(
				new Table({
					name: FX_RATE_TABLE,
					columns: [
						{
							name: 'id',
							type: 'uuid',
							isPrimary: true,
							generationStrategy: 'uuid',
							isGenerated: true,
							default: 'gen_random_uuid()',
						},
						{name: 'currency', type: 'varchar', length: '3'},
						{name: 'rateDate', type: 'date'},
						{name: 'rateToEur', type: 'numeric', precision: 20, scale: 12},
						{name: 'provider', type: 'varchar', length: '32'},
						{name: 'createdAt', type: 'timestamptz', default: 'now()'},
					],
				}),
				true,
			);
		}

		const table = await queryRunner.getTable(FX_RATE_TABLE);
		if (table && !table.indices.some((index) => index.name === FX_RATE_INDEX)) {
			await queryRunner.createIndex(
				FX_RATE_TABLE,
				new TableIndex({name: FX_RATE_INDEX, columnNames: ['currency', 'rateDate'], isUnique: true}),
			);
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (await queryRunner.hasTable(FX_RATE_TABLE)) {
			const table = await queryRunner.getTable(FX_RATE_TABLE);
			const index = table?.indices.find((candidate) => candidate.name === FX_RATE_INDEX);
			if (index) await queryRunner.dropIndex(FX_RATE_TABLE, index);
			await queryRunner.dropTable(FX_RATE_TABLE);
		}
		if (
			(await queryRunner.hasTable('bank_transactions')) &&
			(await queryRunner.hasColumn('bank_transactions', 'amountInBaseCurrency'))
		) {
			await queryRunner.dropColumn('bank_transactions', 'amountInBaseCurrency');
		}
		if ((await queryRunner.hasTable('accounts')) && (await queryRunner.hasColumn('accounts', 'baseCurrency'))) {
			await queryRunner.dropColumn('accounts', 'baseCurrency');
		}
	}
}
