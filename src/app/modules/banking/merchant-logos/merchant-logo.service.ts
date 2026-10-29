import {InjectQueue} from '@nestjs/bullmq';
import {Injectable, Logger, NotFoundException, OnApplicationBootstrap} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {Queue} from 'bullmq';
import {createHash} from 'node:crypto';
import {Brackets, DataSource, In, IsNull, LessThanOrEqual, Or, Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {
	FETCH_MERCHANT_LOGO_JOB,
	IDENTIFY_MERCHANTS_JOB,
	MERCHANT_LOGO_QUEUE,
	MERCHANT_LOGO_RECONCILE_SCHEDULER_ID,
	RECONCILE_MERCHANT_LOGOS_JOB,
} from '@core/queue/queue.constants';

import merchantContract from '../../../../../ops/claude-bridge/merchant-contract.json';
import {MERCHANT_LOGO_NOT_FOUND} from '../api/constants/banking-messages.constants';
import {BankTransaction} from '../bank-transaction.entity';
import {chunkArray, safeErrorName} from '../banking.utils';
import {
	toBankTransactionCategorizationInput,
	toBankTransactionCategorizationWebSearchInput,
	toMerchantIdentificationName,
} from '../categorization/bank-transaction-categorization-input';
import {BankTransactionCategorizationUnavailableError} from '../categorization/bank-transaction-categorization.provider';
import {MerchantIdentificationInput} from '../categorization/bank-transaction-categorization.types';
import {
	getMerchantKeyName,
	getMerchantKeysForName,
	isTransferDescriptionMerchantKey,
} from '../categorization/bank-transaction-merchant-key';
import {ClaudeBankTransactionCategorizationProvider} from '../categorization/providers/claude-bank-transaction-categorization.provider';
import {LogoDevClient} from './logo-dev.client';
import {MERCHANT_LOGO_STATUSES, MerchantLogo} from './merchant-logo.entity';
import {
	Homepage,
	MERCHANT_LOGO_SIZE,
	MIN_ICON_SIZE,
	MerchantLogoImage,
	chooseMerchantLogos,
	encodeMerchantLogo,
	iconCandidates,
	isPlatformDefaultIcon,
	parseHomepage,
	parseManifestIcons,
} from './merchant-site';
import {MerchantSiteFetcher, toPublicHttpsUrl} from './merchant-site-fetcher';
import {MERCHANT_STATUSES, Merchant} from './merchant.entity';

export type IdentifyMerchantsJobData = {merchantIds: string[]};
export type FetchMerchantLogoJobData = {logoId: string};
export type MerchantLogoJobData = IdentifyMerchantsJobData | FetchMerchantLogoJobData | Record<string, never>;

const BATCH_SIZE = merchantContract.maxMerchants;
const MAX_ATTEMPTS = 3;
const RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [DAY_MS, 3 * DAY_MS];
const MISSING_RECHECK_MS = 30 * DAY_MS;
const READY_REFRESH_MS = 180 * DAY_MS;
const HOMEPAGE_BYTES = 512 * 1024;
const MANIFEST_BYTES = 64 * 1024;
const ICON_BYTES = 1024 * 1024;
/** A public favicon service, asked for a site's icon with only its hostname when the site serves none we can use. */
const FAVICON_SERVICE_URL = 'https://icons.duckduckgo.com/ip3/';

const {PENDING, IDENTIFIED, NONE} = MERCHANT_STATUSES;
const {READY, MISSING} = MERCHANT_LOGO_STATUSES;

/** A logo URL path: the version changes whenever the image does, so browsers can cache it forever. */
function logoPath(id: string, version: string): string {
	return `/merchant-logos/${id}/${version}`;
}

/**
 * Shows a logo for the merchant of a transaction. A merchant is identified once per owner and merchant key by the
 * categorization model (brand and most likely official website), the website must call itself that brand, and the
 * logo comes from logo.dev, or from the site's own icons or a favicon service when those are larger. Display only:
 * categories, merchant keys and recurring payments never read it.
 */
@Injectable()
export class MerchantLogoService implements OnApplicationBootstrap {
	private readonly logger = new Logger(MerchantLogoService.name);

	constructor(
		@InjectRepository(Merchant) private readonly merchants: Repository<Merchant>,
		@InjectRepository(MerchantLogo) private readonly logos: Repository<MerchantLogo>,
		@InjectRepository(BankTransaction) private readonly transactions: Repository<BankTransaction>,
		@InjectQueue(MERCHANT_LOGO_QUEUE) private readonly queue: Queue<MerchantLogoJobData>,
		private readonly dataSource: DataSource,
		private readonly configurationService: ConfigurationService,
		private readonly provider: ClaudeBankTransactionCategorizationProvider,
		private readonly fetcher: MerchantSiteFetcher,
		private readonly logoDev: LogoDevClient,
	) {}

	private isEnabled(): boolean {
		return this.configurationService.get('MERCHANT_LOGOS_ENABLED');
	}

	private canAcquire(): boolean {
		return this.isEnabled() && !this.configurationService.get('MERCHANT_LOGOS_CACHED_ONLY');
	}

	async onApplicationBootstrap(): Promise<void> {
		if (this.configurationService.get('NODE_ENV') === 'test') return;
		try {
			if (!this.canAcquire()) {
				await this.queue.removeJobScheduler(MERCHANT_LOGO_RECONCILE_SCHEDULER_ID);
				return;
			}
			await this.queue.upsertJobScheduler(
				MERCHANT_LOGO_RECONCILE_SCHEDULER_ID,
				{every: RECONCILE_INTERVAL_MS},
				{
					name: RECONCILE_MERCHANT_LOGOS_JOB,
					data: {},
					opts: {attempts: 1, removeOnComplete: true, removeOnFail: {age: 86_400, count: 100}},
				},
			);
			await this.queue.add(RECONCILE_MERCHANT_LOGOS_JOB, {}, {removeOnComplete: true, removeOnFail: true});
		} catch (error) {
			this.logger.warn(`Merchant logo scheduling failed: ${safeErrorName(error)}`);
		}
	}

	/**
	 * Called after a sync persisted rows: adds the owner's new merchants and queues identification right away,
	 * without failing the sync; the hourly reconcile picks up anything missed.
	 */
	async enqueueForOwnerSafely(accountId: string): Promise<void> {
		if (!this.canAcquire()) return;
		try {
			await this.addMerchants(accountId);
			await this.enqueuePendingIdentifications();
		} catch (error) {
			this.logger.warn(`Merchant logo enqueue failed: ${safeErrorName(error)}`);
		}
	}

	/** Hourly: new merchants, identifications left pending, and logos due for a retry, recheck or refresh. */
	async reconcile(): Promise<void> {
		if (!this.canAcquire()) return;
		const owners: {accountId: string}[] = await this.dataSource.query(
			'SELECT DISTINCT "accountId" FROM bank_connections',
		);
		for (const {accountId} of owners) await this.addMerchants(accountId);
		await this.enqueuePendingIdentifications();
		const due = await this.logos.find({
			select: {id: true},
			where: [{retryAfter: LessThanOrEqual(new Date())}, {status: PENDING, retryAfter: IsNull()}],
			take: 200,
		});
		for (const {id} of due) await this.enqueueLogo(id);
	}

	async identifyMerchants(merchantIds: readonly string[]): Promise<void> {
		if (!this.canAcquire()) return;
		const merchants = await this.merchants.find({
			where: {id: In([...new Set(merchantIds)].slice(0, BATCH_SIZE)), status: PENDING},
		});
		const inputs: MerchantIdentificationInput[] = [];
		for (const merchant of merchants) {
			const input = await this.toIdentificationInput(merchant);
			if (input) inputs.push(input);
			else await this.merchants.update({id: merchant.id, status: PENDING}, {status: NONE});
		}
		if (!inputs.length) return;
		let results;
		try {
			results = await this.provider.identifyMerchants(inputs);
		} catch (error) {
			// Both routes unavailable: stay pending for the hourly retry. Anything else counts as a failed attempt.
			if (error instanceof BankTransactionCategorizationUnavailableError) return;
			for (const {correlationId} of inputs) await this.recordFailedIdentification(correlationId);
			return;
		}
		for (const result of results) {
			// A payment service the statement names on its own shows its own logo.
			const named = result.kind === 'BUSINESS' || result.kind === 'PAYMENT_SERVICE';
			const status = named && result.brand ? IDENTIFIED : NONE;
			const logo = status === IDENTIFIED && result.domain ? await this.findOrCreateLogo(result.domain) : null;
			await this.merchants.update(
				{id: result.correlationId, status: PENDING},
				{
					status,
					brand: result.brand,
					domain: result.domain,
					domainConfident: result.domainConfident,
					logoId: logo?.id ?? null,
					retryAfter: null,
				},
			);
			if (logo?.status === PENDING) await this.enqueueLogo(logo.id);
		}
	}

	/**
	 * Reads a site's names and its sharpest logo. The homepage's names are the evidence that the domain belongs to the
	 * brand, so names and image are stored together. logo.dev's logo comes first; when it has none of at least the
	 * logo's size, the site's own icons are tried, and when those are small too or the homepage does not load, the
	 * favicon service's icon. The largest wins. A logo without a loaded homepage
	 * shows only for a domain the model was sure of. Failures back off and are retried a few times, then rechecked
	 * monthly.
	 */
	async fetchLogo(logoId: string): Promise<void> {
		if (!this.canAcquire()) return;
		const logo = await this.logos.findOneBy({id: logoId});
		if (!logo || (logo.retryAfter && logo.retryAfter > new Date())) return;
		const origin = `https://${logo.domain}/`;
		const homepage = await this.fetcher
			.fetch(origin, {accept: 'text/html,application/xhtml+xml', maxBytes: HOMEPAGE_BYTES, truncate: true})
			.then(
				(page) => parseHomepage(page.bytes.toString('utf8'), page.url),
				() => null,
			);
		// A refresh that cannot read the homepage keeps a logo its homepage confirmed.
		const keepConfirmed = !homepage && logo.status === READY && logo.homepageLoaded;
		let icon: (MerchantLogoImage & {source: string}) | null = null;
		/** When logo.dev could not answer yet, how soon to ask it again. */
		let askLogoDevAfterMs: number | null = null;
		const larger = (candidate: (MerchantLogoImage & {source: string}) | null) => {
			if (candidate && candidate.size > (icon?.size ?? 0)) icon = candidate;
		};
		if (!homepage?.parked) {
			// logo.dev does not need the homepage, so a confirmed logo is still renewed from it.
			const logoDev = await this.logoDev.findLogo(logo.domain);
			if (logoDev.status === 'later') askLogoDevAfterMs = logoDev.retryAfterMs;
			if (logoDev.status === 'found' && logoDev.size >= MIN_ICON_SIZE) {
				const image = await this.fetchIconFrom(logoDev.url);
				// The download is enlarged to a fixed size, so the original's size is the one that counts.
				if (image) icon = {...image, size: logoDev.size, source: logoDev.url.split('?')[0]};
			}
			// A refresh without the homepage only takes a logo at least as sharp as the confirmed one it has.
			if (keepConfirmed && (icon?.size ?? 0) < (logo.sourceSize ?? 0)) icon = null;
			// The site's own icons, then the favicon service's, when logo.dev has no large logo: the largest wins.
			// A site that refuses its homepage often still serves its icons at the conventional paths.
			if (!keepConfirmed && (icon?.size ?? 0) < MERCHANT_LOGO_SIZE)
				larger(await this.fetchSiteIcon(homepage, origin));
			if (!keepConfirmed && (icon?.size ?? 0) < MERCHANT_LOGO_SIZE)
				larger(await this.fetchIconFrom(`${FAVICON_SERVICE_URL}${logo.domain}.ico`));
		}
		const now = new Date();
		if (icon) {
			// Without its homepage the site is read again sooner, so its own names can confirm it; when logo.dev could
			// not answer yet, it is asked again when it said.
			const refreshMs = askLogoDevAfterMs ?? (homepage ? READY_REFRESH_MS : MISSING_RECHECK_MS);
			await this.logos.update(logo.id, {
				status: READY,
				image: icon.png,
				version: createHash('sha256').update(icon.png).digest('hex'),
				sourceUrl: icon.source,
				sourceSize: icon.size,
				monochrome: icon.monochrome,
				homepageLoaded: !!homepage || keepConfirmed,
				siteNames: homepage?.names ?? (keepConfirmed ? logo.siteNames : []),
				attempts: 0,
				fetchedAt: now,
				retryAfter: new Date(now.getTime() + refreshMs),
			});
			return;
		}
		const attempts = logo.attempts + 1;
		const exhausted = attempts >= MAX_ATTEMPTS || homepage?.parked;
		await this.logos.update(logo.id, {
			// A refresh that fails keeps the logo it has and the names that confirmed it.
			status: logo.status === READY && !homepage?.parked ? READY : exhausted ? MISSING : PENDING,
			attempts: exhausted ? 0 : attempts,
			fetchedAt: now,
			// When logo.dev could not answer yet, it is asked again when it said.
			retryAfter: new Date(
				now.getTime() + (askLogoDevAfterMs ?? (exhausted ? MISSING_RECHECK_MS : RETRY_DELAYS_MS[attempts - 1])),
			),
		});
	}

	/**
	 * Logo URLs for the given transactions of one owner; absent when no confirmed logo exists. Own transfers and
	 * currency exchanges move the owner's own money, so they never show a merchant's logo.
	 */
	async getLogoUrls(
		accountId: string,
		transactions: readonly Pick<
			BankTransaction,
			'id' | 'merchantKey' | 'ownTransferEvidence' | 'financialEventType'
		>[],
	): Promise<Map<string, string>> {
		const urls = new Map<string, string>();
		if (!this.isEnabled()) return urls;
		const merchantRows = transactions.filter(
			({ownTransferEvidence, financialEventType}) => !ownTransferEvidence && !financialEventType,
		);
		const keys = [...new Set(merchantRows.map(({merchantKey}) => getMerchantKeyName(merchantKey)))].filter(
			(key): key is string => key !== null,
		);
		if (!keys.length) return urls;
		// The listed merchants, plus the owner's other merchants with a logo, which may share a brand with them.
		const merchants = await this.merchants
			.createQueryBuilder('merchant')
			.leftJoinAndSelect('merchant.logo', 'logo')
			.where('merchant.accountId = :accountId AND merchant.status = :identified', {
				accountId,
				identified: IDENTIFIED,
			})
			.andWhere(
				new Brackets((query) =>
					query.where('merchant.key IN (:...keys)', {keys}).orWhere('logo.status = :ready', {ready: READY}),
				),
			)
			.getMany();
		const chosen = chooseMerchantLogos(merchants);
		for (const transaction of merchantRows) {
			const key = getMerchantKeyName(transaction.merchantKey);
			const logo = key ? chosen.get(key) : undefined;
			if (logo) urls.set(transaction.id, logoPath(logo.id, logo.version));
		}
		return urls;
	}

	/** The PNG for a logo one of the owner's merchants shows; anything else is not found. */
	async getLogoImage(accountId: string, logoId: string, version: string): Promise<Buffer> {
		if (!this.isEnabled()) throw new NotFoundException(MERCHANT_LOGO_NOT_FOUND);
		const logo = await this.logos
			.createQueryBuilder('logo')
			.addSelect('logo.image')
			.innerJoin(Merchant, 'merchant', 'merchant."logoId" = logo.id')
			.where('logo.id = :logoId AND logo.version = :version AND logo.status = :ready', {
				logoId,
				version,
				ready: READY,
			})
			.andWhere('merchant."accountId" = :accountId AND merchant.status = :identified', {
				accountId,
				identified: IDENTIFIED,
			})
			.getOne();
		if (!logo?.image) throw new NotFoundException(MERCHANT_LOGO_NOT_FOUND);
		return logo.image;
	}

	/** Creates a pending merchant for every merchant key of the owner's purchases, refunds and payments. */
	private async addMerchants(accountId: string): Promise<void> {
		await this.dataSource.query(
			// The lateral name is the SQL form of getMerchantKeyName.
			`INSERT INTO merchants ("accountId", key)
			SELECT DISTINCT c."accountId", merchant.name
			FROM bank_transactions t
			JOIN bank_accounts a ON a.id = t."bankAccountId"
			JOIN bank_connections c ON c.id = a."bankConnectionId"
			CROSS JOIN LATERAL (SELECT substring(t."merchantKey" from position(':' in t."merchantKey") + 1) AS name) merchant
			WHERE c."accountId" = $1 AND t."ownTransferEvidence" IS NULL AND t."financialEventType" IS NULL
				AND merchant.name <> ''
			ON CONFLICT ("accountId", key) DO NOTHING`,
			[accountId],
		);
	}

	private async enqueuePendingIdentifications(): Promise<void> {
		const pending = await this.merchants.find({
			select: {id: true},
			where: {status: PENDING, retryAfter: Or(IsNull(), LessThanOrEqual(new Date()))},
			order: {id: 'ASC'},
		});
		for (const batch of chunkArray(pending, BATCH_SIZE)) {
			const merchantIds = batch.map(({id}) => id);
			await this.queue.add(
				IDENTIFY_MERCHANTS_JOB,
				{merchantIds},
				{
					jobId: `identify-${createHash('sha256').update(merchantIds.join(',')).digest('hex').slice(0, 32)}`,
					removeOnComplete: true,
					removeOnFail: true,
				},
			);
		}
	}

	/**
	 * The largest usable icon the site serves, from its page, its web app manifest and the conventional paths. Stops
	 * at the first one of at least the logo's size; declared sizes are often wrong, so smaller ones are all tried.
	 */
	private async fetchSiteIcon(
		homepage: Homepage | null,
		origin: string,
	): Promise<(MerchantLogoImage & {source: string}) | null> {
		const manifest = homepage?.manifest
			? await this.fetcher
					.fetch(toPublicHttpsUrl(homepage.manifest.replace(/^http:/i, 'https:')).href, {
						accept: 'application/manifest+json,application/json',
						maxBytes: MANIFEST_BYTES,
					})
					.then(
						(response) =>
							parseManifestIcons(response.bytes.toString('utf8'), response.url, new URL(origin).hostname),
						() => [],
					)
			: [];
		let best: (MerchantLogoImage & {source: string}) | null = null;
		for (const url of iconCandidates(homepage, origin, manifest)) {
			const icon = await this.fetchIconFrom(url);
			if (icon && icon.size > (best?.size ?? 0)) best = icon;
			if ((best?.size ?? 0) >= MERCHANT_LOGO_SIZE) break;
		}
		return best;
	}

	/** One icon decoded to a logo, or null when it does not load or decode: sites often declare icons they no longer serve. */
	private async fetchIconFrom(url: string): Promise<(MerchantLogoImage & {source: string}) | null> {
		try {
			const response = await this.fetcher.fetch(toPublicHttpsUrl(url).href, {
				accept: 'image/*',
				maxBytes: ICON_BYTES,
			});
			if (isPlatformDefaultIcon(response.url)) return null;
			return {...(await encodeMerchantLogo(response.bytes)), source: response.url};
		} catch {
			return null;
		}
	}

	private async enqueueLogo(logoId: string): Promise<void> {
		await this.queue.add(
			FETCH_MERCHANT_LOGO_JOB,
			{logoId},
			{jobId: `logo-${logoId}`, removeOnComplete: true, removeOnFail: true},
		);
	}

	private async findOrCreateLogo(domain: string): Promise<MerchantLogo> {
		await this.logos.createQueryBuilder().insert().values({domain}).orIgnore().execute();
		return this.logos.findOneByOrFail({domain});
	}

	private async recordFailedIdentification(merchantId: string): Promise<void> {
		const merchant = await this.merchants.findOneBy({id: merchantId, status: PENDING});
		if (!merchant) return;
		const attempts = merchant.attempts + 1;
		await this.merchants.update(
			{id: merchantId, status: PENDING},
			attempts >= MAX_ATTEMPTS
				? {status: NONE, attempts}
				: {attempts, retryAfter: new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1])},
		);
	}

	/**
	 * The merchant as the categorization web search would see it: the sanitized name and location of the newest
	 * non-person transaction, plus the website hostnames earlier searches returned for it.
	 * No amounts, dates or references.
	 */
	private async toIdentificationInput(merchant: Merchant): Promise<MerchantIdentificationInput | null> {
		const rows = await this.transactions
			.createQueryBuilder('transaction')
			.innerJoinAndSelect('transaction.bankAccount', 'bankAccount')
			.innerJoinAndSelect('bankAccount.bankConnection', 'connection')
			.where('connection.accountId = :accountId', {accountId: merchant.accountId})
			.andWhere('transaction."merchantKey" IN (:...keys)', {keys: getMerchantKeysForName(merchant.key)})
			.andWhere('transaction."ownTransferEvidence" IS NULL AND transaction."financialEventType" IS NULL')
			.orderBy('transaction.bookingDate', 'DESC', 'NULLS LAST')
			.addOrderBy('transaction.createdAt', 'DESC')
			.getMany();
		// Filter before taking the recent sample so older business evidence on the same key remains eligible.
		const candidates = rows.filter((row) => !isTransferDescriptionMerchantKey(row)).slice(0, 20);
		const [newest] = candidates;
		if (!newest) return null;
		const input = toBankTransactionCategorizationInput({
			...newest,
			aspspName: newest.bankAccount.bankConnection.aspspName,
		});
		const name = toMerchantIdentificationName(input);
		if (!name) return null;
		const searchSourceDomains = [
			...new Set(candidates.flatMap((row) => row.categorySearchTrace?.sourceDomains ?? [])),
		];
		return {
			correlationId: merchant.id,
			name,
			location: toBankTransactionCategorizationWebSearchInput(input)?.merchantLocation ?? null,
			transactionType: input.transactionType,
			direction: input.direction,
			searchSourceDomains,
		};
	}
}
