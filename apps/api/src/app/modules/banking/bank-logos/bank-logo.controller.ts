import {Controller, Get, Param, Res, StreamableFile} from '@nestjs/common';
import {Throttle, minutes} from '@nestjs/throttler';
import type {BankLogo} from '@tempo/contracts';
import {Response} from 'express';

import {BankLogoService} from './bank-logo.service';

@Controller('bank-connections/aspsps/logos')
export class BankLogoController {
	constructor(private readonly logos: BankLogoService) {}

	@Get(':country/:name')
	@Throttle({default: {limit: 1200, ttl: minutes(1)}})
	async metadata(
		@Param('country') country: string,
		@Param('name') name: string,
		@Res({passthrough: true}) response: Response,
	): Promise<BankLogo> {
		const logo = await this.logos.getMetadata(country, Buffer.from(name, 'base64url').toString('utf8'));
		response.set('Cache-Control', 'private, max-age=86400');
		return logo;
	}

	@Get(':country/:name/:algorithm/:hash')
	@Throttle({default: {limit: 1200, ttl: minutes(1)}})
	async image(
		@Param('country') country: string,
		@Param('name') name: string,
		@Param('algorithm') algorithm: string,
		@Param('hash') hash: string,
		@Res({passthrough: true}) response: Response,
	): Promise<StreamableFile> {
		const image = await this.logos.getImage(
			country,
			Buffer.from(name, 'base64url').toString('utf8'),
			algorithm,
			hash,
		);
		response.set({
			'Cache-Control': 'private, max-age=31536000, immutable',
			'Cross-Origin-Resource-Policy': 'same-site',
		});
		return new StreamableFile(image, {type: 'image/png', length: image.length});
	}
}
