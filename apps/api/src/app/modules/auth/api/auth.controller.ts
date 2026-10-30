import {Body, Controller, Delete, Get, Head, HttpCode, Param, Post, Query, Req, Res, UseGuards} from '@nestjs/common';
import {Throttle, minutes} from '@nestjs/throttler';
import type {Account as AccountResponse, MessageResponse, Session} from '@tempo/contracts';
import {Request, Response} from 'express';

import {ConfigurationService} from '@core/config/config.service';
import {SessionService} from '@core/session/session.service';
import {Account} from '@modules/account/account.entity';
import {toAccountResponse} from '@modules/account/api/account-response';

import {CurrentAccount} from '../decorators/current-user.decorator';
import {Public} from '../decorators/public.decorator';
import {SkipEmailVerification} from '../decorators/skip-email-verification.decorator';
import {CsrfOriginGuard} from '../guards/csrf-origin.guard';
import {LocalLogInGuard} from '../guards/local-login.guard';
import {AuthService} from '../services/auth.service';
import {EmailVerifierService} from '../services/email-verifier.service';
import {PasswordResetService} from '../services/password-reset.service';
import {EMAIL_VERIFICATION_SUCCESS} from './constants/api-messages.constants';
import {EmailChangeVerifyDto} from './dtos/email-change-verify.dto';
import {EmailChangeRequestDto} from './dtos/email-change.dto';
import {EmailCheckDto} from './dtos/email-check.dto';
import {EmailVerifyDto} from './dtos/email-verify.dto';
import {LogInDto} from './dtos/login.dto';
import {PasswordChangeDto} from './dtos/password-change.dto';
import {PasswordResetRequestDto} from './dtos/password-reset-request.dto';
import {PasswordResetVerifyDto} from './dtos/password-reset-verify.dto';
import {SessionRevokeDto} from './dtos/session-revoke.dto';
import {SignUpDto} from './dtos/signup.dto';

@Controller('auth')
export class AuthController {
	constructor(
		private readonly emailVerifierService: EmailVerifierService,
		private readonly authService: AuthService,
		private readonly sessionService: SessionService,
		private readonly passwordResetService: PasswordResetService,
		private readonly configurationService: ConfigurationService,
	) {}

	@Public()
	@Post('signup')
	@HttpCode(201)
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	async signUp(@Body() dto: SignUpDto, @Req() request: Request): Promise<AccountResponse> {
		return toAccountResponse(await this.authService.signUp(dto, request));
	}

	@Public()
	@Post('login')
	@HttpCode(200)
	@UseGuards(LocalLogInGuard)
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	logIn(@Body() _dto: LogInDto, @CurrentAccount() account: Account): AccountResponse {
		return toAccountResponse(account);
	}

	@Post('logout')
	@HttpCode(200)
	@SkipEmailVerification()
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	async logOut(@Req() request: Request, @Res({passthrough: true}) res: Response): Promise<MessageResponse> {
		res.clearCookie(this.configurationService.get('SESSION_COOKIE_NAME'), {
			path: this.configurationService.get('SESSION_COOKIE_PATH'),
		});
		return await this.authService.logOut(request);
	}

	@Post('signup/resend')
	@HttpCode(200)
	@SkipEmailVerification()
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	async resendWelcomeEmail(@CurrentAccount() account: Account): Promise<MessageResponse> {
		return await this.emailVerifierService.sendWelcomeEmail(account);
	}

	@Public()
	@Post('signup/verify')
	@HttpCode(200)
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	async verifyEmail(@Body() dto: EmailVerifyDto, @Req() request: Request): Promise<MessageResponse> {
		const user = await this.emailVerifierService.verifySignup(dto.code, dto.email);
		if (!request.isAuthenticated()) {
			await this.authService.logIn(user, request);
		}
		return {message: EMAIL_VERIFICATION_SUCCESS};
	}

	@Head('change-email/check')
	@HttpCode(204)
	@Throttle({default: {limit: 10, ttl: minutes(1)}})
	async checkEmailAvailability(@Query() query: EmailCheckDto) {
		return await this.emailVerifierService.checkEmailAvailability(query.email);
	}

	@Post('change-email/request')
	@UseGuards(CsrfOriginGuard)
	@HttpCode(200)
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	async requestEmailChange(
		@CurrentAccount() account: Account,
		@Body() dto: EmailChangeRequestDto,
	): Promise<MessageResponse> {
		return await this.emailVerifierService.requestEmailChange(account, dto.newEmail);
	}

	@Post('change-email/verify')
	@UseGuards(CsrfOriginGuard)
	@HttpCode(200)
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	async verifyEmailChange(
		@CurrentAccount() account: Account,
		@Body() dto: EmailChangeVerifyDto,
	): Promise<MessageResponse> {
		return await this.emailVerifierService.verifyEmailChange(account, dto.token, dto.email);
	}

	@Post('change-password')
	@HttpCode(200)
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	async changePassword(
		@CurrentAccount() account: Account,
		@Body() dto: PasswordChangeDto,
		@Req() request: Request,
	): Promise<MessageResponse> {
		return await this.authService.changePassword(account, dto, request.session.id);
	}

	@Public()
	@Post('reset-password/request')
	@HttpCode(200)
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	async requestPasswordReset(@Body() dto: PasswordResetRequestDto): Promise<MessageResponse> {
		return this.passwordResetService.requestPasswordReset(dto.email);
	}

	@Public()
	@Post('reset-password/verify')
	@HttpCode(200)
	@Throttle({default: {limit: 5, ttl: minutes(1)}})
	async resetPassword(@Body() dto: PasswordResetVerifyDto): Promise<MessageResponse> {
		return this.passwordResetService.resetPassword(dto.newPassword, dto.token);
	}

	@Get('sessions')
	@HttpCode(200)
	async getSessions(@CurrentAccount() account: Account, @Req() request: Request): Promise<Session[]> {
		return await this.sessionService.getSessions(account.id, request.session.id);
	}

	@Delete('sessions/:sessionId')
	@HttpCode(200)
	async revokeSession(
		@CurrentAccount() account: Account,
		@Req() request: Request,
		@Param() dto: SessionRevokeDto,
	): Promise<MessageResponse> {
		return await this.sessionService.revokeSession(account.id, request.session.id, dto.sessionId);
	}

	@Delete('sessions')
	@HttpCode(200)
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	async revokeAllOtherSessions(
		@CurrentAccount() account: Account,
		@Req() request: Request,
	): Promise<MessageResponse> {
		return await this.sessionService.revokeAllOtherSessions(account.id, request.session.id);
	}
}
