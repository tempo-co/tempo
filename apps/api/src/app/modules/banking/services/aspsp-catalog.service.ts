import {BadGatewayException, Inject, Injectable, Logger} from '@nestjs/common';
import type {BankConnectionAspsp} from '@tempo/contracts';
import Redis from 'ioredis';

import {ConfigurationService} from '@core/config/config.service';
import {REDIS} from '@core/redis/redis.constants';

import {BANKING_SUPPORTED_BANKS_UNAVAILABLE} from '../api/constants/banking-messages.constants';
import {bankLogoReference} from '../bank-logos/bank-logo-reference';
import {safeErrorName} from '../banking.utils';
import {EnableBankingAspsp} from '../enable-banking.types';
import {ensureBankingIntegrationEnabled} from './bank-connection.utils';
import {EnableBankingClient} from './enable-banking.client';

const CACHED_CATALOG_TTL_SECONDS = 60 * 60;

/** The Enable Banking bank (ASPSP) catalog: the live bank picker list and a per-country Redis cache for every other reader. */
@Injectable()
export class AspspCatalogService {
	private readonly logger = new Logger(AspspCatalogService.name);

	constructor(
		private readonly configurationService: ConfigurationService,
		private readonly enableBankingClient: EnableBankingClient,
		@Inject(REDIS) private readonly redis: Redis,
	) {}

	/** Every supported bank once per country and name, sorted for the bank picker. */
	async findSupportedAspsps(): Promise<BankConnectionAspsp[]> {
		ensureBankingIntegrationEnabled(this.configurationService);
		const aspsps = await this.fetchAspsps();
		const uniqueAspsps = new Map<string, BankConnectionAspsp>();

		for (const {name, country, logoUrl} of aspsps) {
			const key = `${country}:${name}`;
			const existing = uniqueAspsps.get(key);
			if (existing) {
				if (!existing.logoUrl && logoUrl) existing.logoUrl = logoUrl;
				continue;
			}

			uniqueAspsps.set(key, {
				name,
				country,
				...(logoUrl ? {logoUrl} : {}),
				logo: bankLogoReference(name, country),
			});
		}

		return [...uniqueAspsps.values()].sort(
			(left, right) => left.country.localeCompare(right.country) || left.name.localeCompare(right.name),
		);
	}

	/**
	 * The country's catalog for authorization, sync and bank logos, shared through Redis for an hour so they do not
	 * download it every time. Provider failures become a sanitized 502.
	 */
	async getAspsps(country: string, signal?: AbortSignal): Promise<EnableBankingAspsp[]> {
		const key = `banking:aspsp-catalog:${country}`;
		try {
			const cached = await this.redis.get(key);
			if (cached) return JSON.parse(cached) as EnableBankingAspsp[];
		} catch (error) {
			this.logger.warn(`Bank catalog cache read failed: ${safeErrorName(error)}`);
		}
		const aspsps = await this.fetchAspsps(country, signal);
		try {
			await this.redis.set(key, JSON.stringify(aspsps), 'EX', CACHED_CATALOG_TTL_SECONDS);
		} catch (error) {
			this.logger.warn(`Bank catalog cache write failed: ${safeErrorName(error)}`);
		}
		return aspsps;
	}

	private async fetchAspsps(country?: string, signal?: AbortSignal): Promise<EnableBankingAspsp[]> {
		try {
			return await this.enableBankingClient.getAspsps(country, signal);
		} catch (error) {
			if (error instanceof BadGatewayException) throw error;
			throw new BadGatewayException(BANKING_SUPPORTED_BANKS_UNAVAILABLE);
		}
	}
}
