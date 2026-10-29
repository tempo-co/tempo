import {Controller, Get, Param, ParseUUIDPipe, Res, StreamableFile} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {Throttle, minutes} from '@nestjs/throttler';
import {Response} from 'express';

import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';

import {MERCHANT_LOGO_MASK_VERSION} from './merchant-logo-mask';
import {MerchantLogoMaskService} from './merchant-logo-mask.service';
import {MerchantLogoService} from './merchant-logo.service';

@ApiTags('Merchant logos')
@Controller('merchant-logos')
export class MerchantLogoController {
	constructor(
		private readonly merchantLogoService: MerchantLogoService,
		private readonly masks: MerchantLogoMaskService,
	) {}

	@Get(`:logoId/:version/${MERCHANT_LOGO_MASK_VERSION}`)
	@Throttle({default: {limit: 1200, ttl: minutes(1)}})
	async getMask(
		@CurrentAccount() account: Account,
		@Param('logoId', ParseUUIDPipe) logoId: string,
		@Param('version') version: string,
		@Res({passthrough: true}) response: Response,
	): Promise<StreamableFile> {
		// Recheck ownership, READY status, version and feature flag before any shared derivative lookup.
		const original = await this.merchantLogoService.getLogoImage(account.id, logoId, version);
		const image = await this.masks.getImage(original);
		return this.png(response, image);
	}

	/** A list page loads one logo per merchant shown, so the limit is per image request, well above browsing. */
	@Get(':logoId/:version')
	@Throttle({default: {limit: 1200, ttl: minutes(1)}})
	async getLogo(
		@CurrentAccount() account: Account,
		@Param('logoId', ParseUUIDPipe) logoId: string,
		@Param('version') version: string,
		@Res({passthrough: true}) response: Response,
	): Promise<StreamableFile> {
		const image = await this.merchantLogoService.getLogoImage(account.id, logoId, version);
		return this.png(response, image);
	}

	/** Called after a successful lookup: only found images may be cached as immutable. */
	private png(response: Response, image: Buffer): StreamableFile {
		response.set({
			'Cache-Control': 'private, max-age=31536000, immutable',
			'Cross-Origin-Resource-Policy': 'same-site',
		});
		return new StreamableFile(image, {type: 'image/png', length: image.length});
	}
}
