import {Inject, Injectable, NotFoundException} from '@nestjs/common';
import Redis from 'ioredis';
import {createHash} from 'node:crypto';

import {REDIS} from '@core/redis/redis.constants';

import {MERCHANT_LOGO_NOT_FOUND} from '../api/constants/banking-messages.constants';
import {LogoCache} from '../logo-cache';
import {MERCHANT_LOGO_MASK_VERSION, MerchantLogoMaskVersion, createMerchantLogoMask} from './merchant-logo-mask';

/** Shared derivative bytes, never an authorization boundary. The controller checks the source first. */
@Injectable()
export class MerchantLogoMaskService {
	private readonly cache: LogoCache;
	constructor(@Inject(REDIS) redis: Redis) {
		this.cache = new LogoCache(redis);
	}

	/** Each algorithm version has its own key prefix and bounded index. */
	getImage(original: Buffer, version: MerchantLogoMaskVersion = MERCHANT_LOGO_MASK_VERSION): Promise<Buffer> {
		return this.cache.getOrCreate(
			`merchant-logo:${version}:`,
			createHash('sha256').update(original).digest('hex'),
			async () => {
				const image = await createMerchantLogoMask(original, version);
				if (!image) throw new NotFoundException(MERCHANT_LOGO_NOT_FOUND);
				return image;
			},
		);
	}
}
