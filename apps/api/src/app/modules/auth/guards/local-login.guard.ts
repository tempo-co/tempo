import {CanActivate, ExecutionContext, Injectable} from '@nestjs/common';
import {AuthGuard} from '@nestjs/passport';
import {Request} from 'express';

import {SessionService} from '@core/session/session.service';

@Injectable()
export class LocalLogInGuard extends AuthGuard('local') implements CanActivate {
	constructor(private readonly sessionService: SessionService) {
		super();
	}

	async canActivate(context: ExecutionContext) {
		const result = (await super.canActivate(context)) as boolean;
		const request = context.switchToHttp().getRequest<Request>();

		await super.logIn(request);
		await this.sessionService.initializeSessionMetadata(request);
		return result;
	}
}
