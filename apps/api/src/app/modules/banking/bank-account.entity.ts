import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

import {BankConnection} from './bank-connection.entity';

@Entity('bank_accounts')
@Index('idx_bank_accounts_connection_identification_hash', ['bankConnection', 'identificationHash'])
@Index('idx_bank_accounts_connection_provider_account_id', ['bankConnection', 'providerAccountId'])
export class BankAccount {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => BankConnection, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'bankConnectionId'})
	bankConnection: BankConnection;

	@Column({type: 'varchar', length: 255})
	providerAccountId: string;

	@Column({type: 'text'})
	identificationHash: string;

	@Column({type: 'varchar', length: 255, nullable: true})
	name: string | null;

	@Column({type: 'varchar', length: 255, nullable: true})
	details: string | null;

	@Column({type: 'varchar', length: 255, nullable: true})
	alias: string | null;

	@Column({type: 'varchar', length: 3})
	currency: string;

	@Column({type: 'varchar', length: 32, nullable: true})
	cashAccountType: string | null;

	@Column({type: 'varchar', length: 16, nullable: true})
	usage: string | null;

	@Column({type: 'varchar', length: 255, nullable: true})
	maskedIdentifier: string | null;

	@Column({type: 'varchar', length: 34, nullable: true})
	iban: string | null;

	@Column({type: 'numeric', precision: 20, scale: 8, nullable: true})
	currentBalanceAmount: string | null;

	@Column({type: 'varchar', length: 32, nullable: true})
	currentBalanceType: string | null;

	@Column({type: 'timestamptz', nullable: true})
	balanceUpdatedAt: Date | null;

	@Column({type: 'boolean', default: true})
	isActive: boolean;

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;

	@UpdateDateColumn({type: 'timestamptz'})
	updatedAt: Date;
}
