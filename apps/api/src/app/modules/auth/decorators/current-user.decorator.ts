import {ExecutionContext, createParamDecorator} from '@nestjs/common';
import {Request} from 'express';

export const CurrentAccount = createParamDecorator((_data, ctx: ExecutionContext) => {
	const request = ctx.switchToHttp().getRequest<Request>();
	return request.user;
});
