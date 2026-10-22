import {Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn} from 'typeorm';

export const MERCHANT_LOGO_STATUSES = {PENDING: 'PENDING', READY: 'READY', MISSING: 'MISSING'} as const;
export type MerchantLogoStatus = (typeof MERCHANT_LOGO_STATUSES)[keyof typeof MERCHANT_LOGO_STATUSES];

/** A public website's icon and the names it gives itself, shared by every merchant that names the same domain. */
@Entity('merchant_logos')
@Index('idx_merchant_logos_domain', ['domain'], {unique: true})
export class MerchantLogo {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({type: 'varchar', length: 253})
	domain: string;

	@Column({type: 'varchar', length: 16, default: 'PENDING'})
	status: MerchantLogoStatus;

	/** The page title, og:site_name and application names of the homepage, used to confirm a merchant's brand. */
	@Column({type: 'jsonb', default: () => "'[]'"})
	siteNames: string[];

	/** A normalized square PNG. */
	@Column({type: 'bytea', nullable: true, select: false})
	image: Buffer | null;

	/** SHA-256 of `image`; part of the image URL, so a changed logo gets a new URL. */
	@Column({type: 'varchar', length: 64, nullable: true})
	version: string | null;

	@Column({type: 'text', nullable: true})
	sourceUrl: string | null;

	/** The shorter side of the source image in pixels; a vector icon counts as its render size. */
	@Column({type: 'int', nullable: true})
	sourceSize: number | null;

	/** Whether the homepage loaded for the stored image; when it did not, the image came from a favicon service. */
	@Column({type: 'boolean', default: false})
	homepageLoaded: boolean;

	@Column({type: 'int', default: 0})
	attempts: number;

	/** When the reconciler fetches the site again: a retry, a recheck of a missing logo, or a refresh. */
	@Column({type: 'timestamptz', nullable: true})
	retryAfter: Date | null;

	@Column({type: 'timestamptz', nullable: true})
	fetchedAt: Date | null;

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;

	@UpdateDateColumn({type: 'timestamptz'})
	updatedAt: Date;
}
