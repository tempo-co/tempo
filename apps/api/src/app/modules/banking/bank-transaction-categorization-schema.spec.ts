import {getMetadataArgsStorage} from 'typeorm';

import {BankTransaction} from './bank-transaction.entity';

describe('BankTransaction categorization schema', () => {
	it('stores categorization state with a pending default and private audit fields', () => {
		const columns = getMetadataArgsStorage().columns.filter(({target}) => target === BankTransaction);
		const byName = new Map(columns.map((column) => [column.propertyName, column.options]));

		expect(byName.get('category')).toMatchObject({type: 'varchar', length: 32, nullable: true});
		expect(byName.get('categoryStatus')).toMatchObject({type: 'varchar', length: 16, default: 'PENDING'});
		expect(byName.get('categorySource')).toMatchObject({type: 'varchar', length: 16, nullable: true});
		expect(byName.get('categoryConfidence')).toMatchObject({
			type: 'numeric',
			precision: 4,
			scale: 3,
			nullable: true,
		});
		expect(byName.get('categoryInputHash')).toMatchObject({type: 'varchar', length: 64, nullable: true});
		expect(byName.get('categoryAppliedInputHash')).toMatchObject({type: 'varchar', length: 64, nullable: true});
		expect(byName.get('categoryProvider')).toMatchObject({type: 'varchar', length: 32, nullable: true});
		expect(byName.get('categoryModel')).toMatchObject({type: 'varchar', length: 128, nullable: true});
		expect(byName.get('categoryPromptVersion')).toMatchObject({type: 'varchar', length: 64, nullable: true});
		expect(byName.get('categoryUpdatedAt')).toMatchObject({type: 'timestamptz', nullable: true});
		expect(byName.get('categoryLastError')).toMatchObject({type: 'text', nullable: true});
		expect(byName.get('categorySearchTrace')).toMatchObject({type: 'jsonb', nullable: true});
		expect(byName.get('merchantLocation')).toMatchObject({type: 'jsonb', nullable: true});
		expect(byName.get('financialEventType')).toMatchObject({type: 'varchar', length: 32, nullable: true});
		expect(byName.get('financialEventSource')).toMatchObject({type: 'varchar', length: 16, nullable: true});
		expect(byName.get('financialEventRuleVersion')).toMatchObject({
			type: 'varchar',
			length: 64,
			nullable: true,
		});
	});
});
