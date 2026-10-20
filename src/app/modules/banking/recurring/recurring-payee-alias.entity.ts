import {
	Check,
	Column,
	CreateDateColumn,
	Entity,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BANK_TRANSACTION_CATEGORIES, BankTransactionCategory} from '../categorization/bank-transaction-category';

/** Owner-confirmed payee identity only; categories and direction remain separate payment purposes. */
@Entity('recurring_payee_aliases')
@Check(
	'chk_recurring_payee_aliases_category',
	`"category" IN (${BANK_TRANSACTION_CATEGORIES.map((category) => `'${category}'`).join(', ')})`,
)
@Unique('uq_recurring_payee_aliases_account_merchant_category', ['accountId', 'merchantKey', 'category'])
export class RecurringPayeeAlias {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({type: 'uuid'})
	accountId: string;

	@ManyToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId'})
	account: Account;

	@Column({type: 'text'})
	merchantKey: string;

	@Column({type: 'varchar', length: 32})
	category: BankTransactionCategory;

	@Column({type: 'uuid'})
	payeeGroupId: string;

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;

	@UpdateDateColumn({type: 'timestamptz'})
	updatedAt: Date;
}
