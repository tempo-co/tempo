import {Injectable, NestMiddleware} from '@nestjs/common';
import {NextFunction, Request, Response} from 'express';

import {SessionService} from '@core/session/session.service';

@Injectable()
export class SessionMiddleware implements NestMiddleware {
	constructor(private readonly sessionService: SessionService) {}

	use(req: Request, _res: Response, next: NextFunction): void {
		if (!req.session) return next();
		this.sessionService.updateLastSeen(req.session);
		next();
	}
}
