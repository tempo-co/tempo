import {Inject, Injectable, NotFoundException} from '@nestjs/common';
import type {BankLogo} from '@tempo/contracts';
import Redis from 'ioredis';
import {createHash} from 'node:crypto';

import {REDIS} from '@core/redis/redis.constants';

import {EnableBankingAspsp} from '../enable-banking.types';
import {LogoCache} from '../logo-cache';
import {MerchantSiteFetcher} from '../merchant-logos/merchant-site-fetcher';
import {AspspCatalogService} from '../services/aspsp-catalog.service';
import {BANK_LOGO_VERSION, convertBankLogo} from './bank-logo';
import {bankLogoReference} from './bank-logo-reference';

const DAY = 86400;
const PREFIX = `bank-logo:${BANK_LOGO_VERSION}:`;
const missing = () => new NotFoundException('Bank logo not found.');

@Injectable()
export class BankLogoService {
	private readonly cache: LogoCache;
	private readonly fetcher = new MerchantSiteFetcher();
	private readonly inFlight = new Map<string, Promise<string>>();
	private readonly catalogues = new Map<string, Promise<EnableBankingAspsp[]>>();
	private active = 0;
	private readonly waiting: (() => void)[] = [];

	constructor(
		@Inject(REDIS) private readonly redis: Redis,
		private readonly catalog: AspspCatalogService,
	) {
		this.cache = new LogoCache(redis);
	}

	async getMetadata(country: string, name: string): Promise<BankLogo> {
		if (!/^[A-Z]{2}$/.test(country) || !name || name.length > 512) throw missing();
		try {
			// Only the provider catalog's URLs are fetch sources; a request cannot supply a fetch target.
			const banks = await this.getCatalog(country);
			const source = banks.find(
				(bank) => bank.country === country && bank.name === name && bank.logoUrl,
			)?.logoUrl;
			if (!source) throw missing();
			const hash = await this.getSource(source);
			return {url: `${bankLogoReference(name, country).metadataUrl}/${BANK_LOGO_VERSION}/${hash}`};
		} catch {
			throw missing();
		}
	}

	async getImage(country: string, name: string, algorithm: string, hash: string): Promise<Buffer> {
		if (algorithm !== BANK_LOGO_VERSION || !/^[0-9a-f]{64}$/.test(hash)) throw missing();
		let bytes = await this.redis.getBuffer(PREFIX + hash);
		if (!bytes) {
			const metadata = await this.getMetadata(country, name);
			if (!metadata.url.endsWith(`/${hash}`)) throw missing();
			bytes = await this.redis.getBuffer(PREFIX + hash);
		}
		if (!bytes) throw missing();
		return bytes;
	}

	/** One catalog read per country at a time, so a picker mounting many logos does not repeat it. */
	private async getCatalog(country: string): Promise<EnableBankingAspsp[]> {
		const known = this.catalogues.get(country);
		if (known) return known;
		const work = this.catalog.getAspsps(country);
		this.catalogues.set(country, work);
		try {
			return await work;
		} finally {
			this.catalogues.delete(country);
		}
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

	private async loadSource(source: string): Promise<string> {
		const sourceKey = `bank-logo:source:${createHash('sha256').update(source).digest('hex')}`;
		const previous = await this.redis.get(sourceKey);
		const cached = previous && (await this.redis.getBuffer(PREFIX + previous));
		if (cached) return previous;
		// Bound fetches and image decoding when a picker mounts many banks at once.
		if (this.active >= 4) await new Promise<void>((resolve) => this.waiting.push(resolve));
		this.active++;
		try {
			const {bytes} = await this.fetcher.fetch(source, {accept: 'image/*', maxBytes: 1024 * 1024});
			const hash = createHash('sha256').update(bytes).digest('hex');
			await this.cache.getOrCreate(PREFIX, hash, () => convertBankLogo(bytes));
			await this.redis.set(sourceKey, hash, 'EX', DAY);
			return hash;
		} finally {
			this.active--;
			this.waiting.shift()?.();
		}
	}
}
