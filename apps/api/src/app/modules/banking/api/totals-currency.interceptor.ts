import {CallHandler, ExecutionContext, Injectable, NestInterceptor} from '@nestjs/common';
import {Request} from 'express';
import {Observable, mergeMap} from 'rxjs';
import {DataSource} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {settleTotalsCurrency} from '../reporting-currency';

/**
 * Money responses name the reporting currency from the account read when the request was authenticated. Should the
 * owner change it before the amounts are read, this clears that name rather than let it label amounts in another.
 */
@Injectable()
export class TotalsCurrencyInterceptor implements NestInterceptor {
	constructor(private readonly dataSource: DataSource) {}

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const owner = context.switchToHttp().getRequest<Request & {user?: Account}>().user;
		return next
			.handle()
			.pipe(mergeMap((body) => (owner ? settleTotalsCurrency(this.dataSource.manager, owner, body) : [body])));
	}
}
