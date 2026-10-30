import {Exclude, Expose} from 'class-transformer';
import {Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn} from 'typeorm';

@Entity('accounts')
@Unique('index_accounts_unique_email', ['email'])
export class Account {
	@PrimaryGeneratedColumn('uuid')
	@Expose()
	id: string;

	@Column({type: 'varchar', length: 255})
	@Expose()
	name: string;

	@Index()
	@Column({type: 'varchar', length: 255})
	@Expose()
	email: string;

	@Column({type: 'boolean', default: false})
	@Expose()
	isEmailVerified: boolean;

	@Column({type: 'varchar', length: 3, nullable: true})
	baseCurrency: string | null;

	@Column({type: 'varchar', length: 255})
	@Exclude()
	password: string;

	@CreateDateColumn({type: 'timestamp'})
	@Expose()
	createdAt: Date;

	@UpdateDateColumn()
	@Expose()
	updatedAt: Date;
}
