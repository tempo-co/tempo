import {CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException} from '@nestjs/common';
import {Reflector} from '@nestjs/core';
import {Request, Response} from 'express';

import {ConfigurationService} from '@core/config/config.service';
import {isBearerRequest} from '@core/personal-access-token/bearer-request';
import {isMcpOriginAllowed} from '@core/personal-access-token/mcp-origin.middleware';
import {PersonalAccessTokenService} from '@core/personal-access-token/personal-access-token.service';
import {Account} from '@modules/account/account.entity';

import {EMAIL_NOT_VERIFIED} from '../api/constants/api-messages.constants';
import {MCP_TOKEN_ONLY_KEY} from '../decorators/mcp-token-only.decorator';
import {IS_PUBLIC_KEY} from '../decorators/public.decorator';
import {SKIP_EMAIL_VERIFICATION_KEY} from '../decorators/skip-email-verification.decorator';
import {TOKEN_READABLE_KEY} from '../decorators/token-readable.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly tokens: PersonalAccessTokenService,
		private readonly config: ConfigurationService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<Request>();
		const mcpTokenOnly = this.reflector.getAllAndOverride<boolean>(MCP_TOKEN_ONLY_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		if (mcpTokenOnly) {
			if (!isMcpOriginAllowed(request, new URL(this.config.get('WEB_BASE_URL')).origin)) {
				throw new ForbiddenException();
			}
			let token;
			try {
				token = await this.tokens.authenticate(request.headers.authorization ?? '');
			} catch (error) {
				if (!(error instanceof UnauthorizedException)) throw error;
				context.switchToHttp().getResponse<Response>().setHeader('WWW-Authenticate', 'Bearer');
				throw new UnauthorizedException();
			}
			if (!token.account.isEmailVerified) throw new ForbiddenException(EMAIL_NOT_VERIFIED);
			request.user = token.account;
			await this.tokens.recordUse(token.id);
			return true;
		}
		if (isBearerRequest(request)) {
			const token = await this.tokens.authenticate(request.headers.authorization!);
			const readable = this.reflector.getAllAndOverride<boolean>(TOKEN_READABLE_KEY, [
				context.getHandler(),
				context.getClass(),
			]);
			if (request.method !== 'GET' || !readable) throw new ForbiddenException();
			if (!token.account.isEmailVerified) throw new ForbiddenException(EMAIL_NOT_VERIFIED);
			request.user = token.account;
			await this.tokens.recordUse(token.id);
			return true;
		}
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		if (isPublic) {
			return true;
		}

		const user = request.user as Account;

		if (!request.isAuthenticated()) {
			throw new UnauthorizedException();
		}

		const isSkipEmailVerification = this.reflector.getAllAndOverride<boolean>(SKIP_EMAIL_VERIFICATION_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		if (!isSkipEmailVerification && user && !user.isEmailVerified) {
			throw new ForbiddenException(EMAIL_NOT_VERIFIED);
		}

		return true;
	}
}
