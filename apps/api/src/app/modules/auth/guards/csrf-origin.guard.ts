import {CanActivate, ExecutionContext, ForbiddenException, Injectable} from '@nestjs/common';
import {Request} from 'express';

import {ConfigurationService} from '@core/config/config.service';

@Injectable()
export class CsrfOriginGuard implements CanActivate {
	private readonly allowedOrigin: string;

	constructor(configService: ConfigurationService) {
		this.allowedOrigin = new URL(configService.get('WEB_BASE_URL')).origin;
	}

	canActivate(context: ExecutionContext): boolean {
		const origin = context.switchToHttp().getRequest<Request>().headers.origin;
		if (typeof origin !== 'string' || origin === 'null') {
			throw new ForbiddenException();
		}

		let requestOrigin: string;
		try {
			requestOrigin = new URL(origin).origin;
		} catch {
			throw new ForbiddenException();
		}

		if (requestOrigin !== origin || requestOrigin !== this.allowedOrigin) {
			throw new ForbiddenException();
		}

		return true;
	}
}
