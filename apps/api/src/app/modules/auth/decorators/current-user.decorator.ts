import {ExecutionContext, createParamDecorator} from '@nestjs/common';

export const CurrentAccount = createParamDecorator((_data, ctx: ExecutionContext) => {
	const request = ctx.switchToHttp().getRequest();
	return request.user;
});
