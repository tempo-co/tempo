import {Column, Entity, JoinColumn, OneToOne, PrimaryColumn} from 'typeorm';

import {Account} from '@modules/account/account.entity';

/** The owner's alert choices for every device; an owner without a row gets bank alerts. */
@Entity('push_preferences')
export class PushPreferences {
	@PrimaryColumn({type: 'uuid', primaryKeyConstraintName: 'pk_push_preferences'})
	accountId: string;

	@OneToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId', foreignKeyConstraintName: 'fk_push_preferences_account'})
	account: Account;

	@Column({type: 'boolean', default: true})
	bankConnections: boolean;
}
