import {Inject, Injectable, NotFoundException} from '@nestjs/common';
import type {BankConnectionAspsp, BankLogo} from '@tempo/contracts';
import Redis from 'ioredis';
import {createHash} from 'node:crypto';

import {ConfigurationService} from '@core/config/config.service';
import {REDIS} from '@core/redis/redis.constants';

import {LogoCache} from '../logo-cache';
import {MerchantSiteFetcher} from '../merchant-logos/merchant-site-fetcher';
import {EnableBankingClient} from '../services/enable-banking.client';
import {BANK_LOGO_VERSION, LogoTheme, convertBankLogo} from './bank-logo';
import {bankLogoReference} from './bank-logo-reference';

const DAY = 86400;
const PREFIX = `bank-logo:${BANK_LOGO_VERSION}:`;
type StoredLogo = {
	light: string;
	dark: string;
	plates: Record<LogoTheme, boolean>;
	displayVariants: Record<LogoTheme, LogoTheme>;
};
const missing = () => new NotFoundException('Bank logo not found.');

@Injectable()
export class BankLogoService {
	private readonly cache: LogoCache;
	private readonly fetcher = new MerchantSiteFetcher();
	private readonly inFlight = new Map<string, Promise<{hash: string; logo: StoredLogo}>>();
	private readonly catalogues = new Map<string, Promise<void>>();
	private active = 0;
	private readonly waiting: (() => void)[] = [];

	constructor(
		@Inject(REDIS) private readonly redis: Redis,
		private readonly provider: EnableBankingClient,
		private readonly config: ConfigurationService,
	) {
		this.cache = new LogoCache(redis);
	}

	/** Only provider catalogue URLs enter this registry; a request cannot supply a fetch target. */
	async registerSources(banks: BankConnectionAspsp[]): Promise<void> {
		const countries = new Map<string, [string, string][]>();
		for (const {country, name, logoUrl} of banks) {
			const entries = countries.get(country) ?? [];
			if (logoUrl) entries.push([name, logoUrl]);
			countries.set(country, entries);
		}
		const transaction = this.redis.multi();
		for (const [country, entries] of countries)
			transaction.set(`bank-logo:catalogue:${country}`, JSON.stringify(entries), 'EX', DAY);
		await transaction.exec();
	}

	async getMetadata(country: string, name: string): Promise<BankLogo> {
		if (!/^[A-Z]{2}$/.test(country) || !name || name.length > 512) throw missing();
		try {
			let catalogue = await this.redis.get(`bank-logo:catalogue:${country}`);
			if (!catalogue) {
				if (this.config.get('BANKING_INTEGRATION_ENABLED') === false) throw missing();
				let pending = this.catalogues.get(country);
				if (!pending) {
					pending = this.provider.getAspsps(country).then((banks) => this.registerSources(banks));
					this.catalogues.set(country, pending);
				}
				try {
					await pending;
				} finally {
					this.catalogues.delete(country);
				}
				catalogue = await this.redis.get(`bank-logo:catalogue:${country}`);
			}
			const entries = JSON.parse(catalogue ?? '[]') as [string, string][];
			const source = entries.find(([bank]) => bank === name)?.[1];
			if (!source) throw missing();
			const {hash, logo} = await this.getSource(source);
			const variant = (theme: LogoTheme) => ({
				url: `${bankLogoReference(name, country).metadataUrl}/${BANK_LOGO_VERSION}/${hash}/${logo.displayVariants[theme]}`,
				plate: logo.plates[theme],
			});
			return {light: variant('light'), dark: variant('dark')};
		} catch {
			throw missing();
		}
	}

	async getImage(country: string, name: string, algorithm: string, hash: string, theme: string): Promise<Buffer> {
		if (algorithm !== BANK_LOGO_VERSION || !/^[0-9a-f]{64}$/.test(hash) || (theme !== 'light' && theme !== 'dark'))
			throw missing();
		let bytes = await this.redis.get(PREFIX + hash);
		if (!bytes) {
			const metadata = await this.getMetadata(country, name);
			if (!metadata.light.url.includes(`/${hash}/`)) throw missing();
			bytes = await this.redis.get(PREFIX + hash);
		}
		if (!bytes) throw missing();
		const logo = JSON.parse(bytes) as StoredLogo;
		return Buffer.from(logo[theme], 'base64');
	}

	private async getSource(source: string) {
		const known = this.inFlight.get(source);
		if (known) return known;
		const work = this.loadSource(source);
		this.inFlight.set(source, work);
		try {
			return await work;
		} finally {
			this.inFlight.delete(source);
		}
	}

	private async loadSource(source: string): Promise<{hash: string; logo: StoredLogo}> {
		const sourceKey = `bank-logo:source:${createHash('sha256').update(source).digest('hex')}`;
		const previous = await this.redis.get(sourceKey);
		const cached = previous && (await this.redis.get(PREFIX + previous));
		if (cached) return {hash: previous, logo: JSON.parse(cached) as StoredLogo};
		// Bound fetches and image decoding when a picker mounts many banks at once.
		if (this.active >= 4) await new Promise<void>((resolve) => this.waiting.push(resolve));
		this.active++;
		try {
			const {bytes} = await this.fetcher.fetch(source, {accept: 'image/*', maxBytes: 1024 * 1024});
			const hash = createHash('sha256').update(bytes).digest('hex');
			const stored = await this.cache.getOrCreate(PREFIX, hash, async () => {
				const converted = await convertBankLogo(bytes);
				return Buffer.from(
					JSON.stringify({
						...converted,
						light: converted.light.toString('base64'),
						dark: converted.dark.toString('base64'),
					}),
				);
			});
			await this.redis.set(sourceKey, hash, 'EX', DAY);
			return {hash, logo: JSON.parse(stored.toString()) as StoredLogo};
		} finally {
			this.active--;
			this.waiting.shift()?.();
		}
	}
}
