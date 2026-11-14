import {Exclude, Expose} from 'class-transformer';
import {Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn} from 'typeorm';

import {APP_TIME_ZONE} from '@core/time/app-time-zone';

/**
 * `AUTOMATIC`: every account held one currency, so Tempo used it. `SETUP_PENDING`: accounts hold several currencies
 * and the owner has not chosen yet (`baseCurrency` keeps an automatic one meanwhile). `CONFIRMED`: the owner chose.
 * `PRESET`: set before owners could choose; treated as chosen.
 */
export const BASE_CURRENCY_STATES = ['AUTOMATIC', 'SETUP_PENDING', 'CONFIRMED', 'PRESET'] as const;
export type BaseCurrencyState = (typeof BASE_CURRENCY_STATES)[number];

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

	/** The reporting currency: what `amountInBaseCurrency` and every combined total are in. */
	@Column({type: 'varchar', length: 3, nullable: true})
	baseCurrency: string | null;

	/** How `baseCurrency` was set; null while it never was (`ReportingCurrencyService`). */
	@Column({type: 'varchar', length: 16, nullable: true})
	baseCurrencyState: BaseCurrencyState | null;

	/** Bumped when a change of `baseCurrency` leaves amounts to convert; it clears every converted amount. */
	@Column({type: 'integer', default: 0})
	baseCurrencyRevision: number;

	/** The `baseCurrencyRevision` the conversion job last finished a pass for; totals are ready when they match. */
	@Column({type: 'integer', default: 0})
	baseAmountsRevision: number;

	/** IANA name of the owner's local time zone: alert quiet hours and the MCP default date follow it. */
	@Column({type: 'varchar', length: 64, default: APP_TIME_ZONE})
	timeZone: string;

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
