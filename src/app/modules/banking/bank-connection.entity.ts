import {Exclude} from 'class-transformer';
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

import {Account} from '@modules/account/account.entity';

@Entity('bank_connections')
@Index('idx_bank_connections_account_id', ['account'])
@Index('idx_bank_connections_sync_due', ['status', 'nextSyncAt'])
export class BankConnection {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({type: 'uuid'})
	accountId: string;

	@ManyToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId'})
	account: Account;

	@Column({type: 'varchar', length: 32, default: 'enable-banking'})
	provider: string;

	@Column({type: 'varchar', length: 255})
	aspspName: string;

	@Column({type: 'varchar', length: 2})
	aspspCountry: string;

	@Column({type: 'varchar', length: 255, nullable: true})
	aspspIdentifier: string | null;

	@Exclude()
	@Index('idx_bank_connections_provider_session_id', {unique: true})
	@Column({type: 'varchar', length: 255, nullable: true})
	providerSessionId: string | null;

	@Exclude()
	@Index('idx_bank_connections_authorization_state_hash')
	@Column({type: 'varchar', length: 64, nullable: true})
	authorizationStateHash: string | null;

	@Column({type: 'varchar', length: 50, default: 'PENDING_AUTHORIZATION'})
	status: string;

	@Column({type: 'timestamptz', nullable: true})
	consentValidUntil: Date | null;

	@Column({type: 'timestamptz', nullable: true})
	lastSyncedAt: Date | null;

	@Column({type: 'text', nullable: true})
	lastSyncError: string | null;

	@Column({type: 'timestamptz', nullable: true})
	nextSyncAt: Date | null;

	@Column({type: 'timestamptz', nullable: true})
	syncStartedAt: Date | null;

	@Column({type: 'varchar', length: 32, default: 'IDLE'})
	syncStatus: string;

	@Column({type: 'integer', default: 0})
	syncFailureCount: number;

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;

	@UpdateDateColumn({type: 'timestamptz'})
	updatedAt: Date;
}
