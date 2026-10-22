import {Body, Controller, Delete, Get, Head, HttpCode, Param, Post, Query, Req, Res, UseGuards} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {Throttle, minutes} from '@nestjs/throttler';
import {Request, Response} from 'express';

import {ConfigurationService} from '@core/config/config.service';
import {TOO_MANY_REQUESTS} from '@core/rate-limit/api-messages.constants';
import {
	ALL_OTHER_SESSIONS_REVOKED,
	CANNOT_REVOKE_CURRENT_SESSION,
	INVALID_SESSION,
	NO_OTHER_SESSIONS_TO_REVOKE,
	SESSION_REVOKE_SUCCESS,
} from '@core/session/api-messages.constants';
import {SessionResponseDto} from '@core/session/session-response.dto';
import {SessionService} from '@core/session/session.service';
import {Account} from '@modules/account/account.entity';

import {CurrentAccount} from '../decorators/current-user.decorator';
import {Public} from '../decorators/public.decorator';
import {SkipEmailVerification} from '../decorators/skip-email-verification.decorator';
import {CsrfOriginGuard} from '../guards/csrf-origin.guard';
import {LocalLogInGuard} from '../guards/local-login.guard';
import {AuthService} from '../services/auth.service';
import {EmailVerifierService} from '../services/email-verifier.service';
import {PasswordResetService} from '../services/password-reset.service';
import {
	EMAIL_ALREADY_IN_USE,
	EMAIL_ALREADY_VERIFIED,
	EMAIL_CHANGE_SUCCESS,
	EMAIL_INVALID_TOKEN,
	EMAIL_IS_AVAILABLE,
	EMAIL_VERIFICATION_SENT,
	EMAIL_VERIFICATION_SUCCESS,
	INVALID_CREDENTIALS,
	LOGIN_SUCCESS,
	LOGOUT_SUCCESS,
	PASSWORD_CHANGE_SUCCESS,
	PASSWORD_RESET_CONFIRMATION,
	PASSWORD_RESET_INVALID_TOKEN,
	PASSWORD_RESET_SUCCESS,
	UNAUTHORIZED,
} from './constants/api-messages.constants';
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

@ApiTags('Auth')
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
	@ApiResponse({status: 201, description: 'The created account'})
	@ApiResponse({status: 409, description: EMAIL_ALREADY_IN_USE})
	@ApiResponse({status: 429, description: TOO_MANY_REQUESTS})
	@ApiOperation({summary: 'Creates a new account.'})
	async signUp(@Body() dto: SignUpDto, @Req() request: Request) {
		return await this.authService.signUp(dto, request);
	}

	@Public()
	@Post('login')
	@HttpCode(200)
	@UseGuards(LocalLogInGuard)
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	@ApiResponse({status: 200, description: LOGIN_SUCCESS})
	@ApiResponse({status: 401, description: INVALID_CREDENTIALS})
	@ApiResponse({status: 429, description: TOO_MANY_REQUESTS})
	@ApiOperation({summary: 'Logs in a user and starts a session.'})
	async logIn(@Body() _dto: LogInDto, @CurrentAccount() account: Account) {
		return account;
	}

	@Post('logout')
	@HttpCode(200)
	@SkipEmailVerification()
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	@ApiResponse({status: 200, description: LOGOUT_SUCCESS})
	@ApiResponse({status: 401, description: UNAUTHORIZED})
	@ApiResponse({status: 429, description: TOO_MANY_REQUESTS})
	@ApiOperation({summary: 'Logs out the current user and destroys the session.'})
	async logOut(@Req() request: Request, @Res({passthrough: true}) res: Response) {
		res.clearCookie(this.configurationService.get('SESSION_COOKIE_NAME'), {
			path: this.configurationService.get('SESSION_COOKIE_PATH'),
		});
		return await this.authService.logOut(request);
	}

	@Post('signup/resend')
	@HttpCode(200)
	@SkipEmailVerification()
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	@ApiResponse({status: 200, description: EMAIL_VERIFICATION_SENT})
	@ApiResponse({status: 400, description: EMAIL_ALREADY_VERIFIED})
	@ApiResponse({status: 401, description: UNAUTHORIZED})
	@ApiResponse({status: 429, description: TOO_MANY_REQUESTS})
	@ApiOperation({summary: 'Resends the email verification code to the current user.'})
	async resendWelcomeEmail(@CurrentAccount() account: Account) {
		return await this.emailVerifierService.sendWelcomeEmail(account);
	}

	@Public()
	@Post('signup/verify')
	@HttpCode(200)
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	@ApiResponse({status: 200, description: EMAIL_VERIFICATION_SUCCESS})
	@ApiResponse({status: 400, description: EMAIL_INVALID_TOKEN})
	@ApiResponse({status: 429, description: TOO_MANY_REQUESTS})
	@ApiOperation({summary: "Verifies an account's email using a code."})
	async verifyEmail(@Body() dto: EmailVerifyDto, @Req() request: Request) {
		const user = await this.emailVerifierService.verifySignup(dto.code, dto.email);
		if (!request.isAuthenticated()) {
			await this.authService.logIn(user, request);
		}
		return {message: EMAIL_VERIFICATION_SUCCESS};
	}

	@Head('change-email/check')
	@HttpCode(204)
	@Throttle({default: {limit: 10, ttl: minutes(1)}})
	@ApiResponse({status: 204, description: EMAIL_IS_AVAILABLE})
	@ApiResponse({status: 401, description: UNAUTHORIZED})
	@ApiResponse({status: 409, description: EMAIL_ALREADY_IN_USE})
	@ApiResponse({status: 429, description: TOO_MANY_REQUESTS})
	@ApiOperation({summary: 'Checks if an email address is available for use.'})
	async checkEmailAvailability(@Query() query: EmailCheckDto) {
		return await this.emailVerifierService.checkEmailAvailability(query.email);
	}

	@Post('change-email/request')
	@UseGuards(CsrfOriginGuard)
	@HttpCode(200)
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	@ApiResponse({status: 200, description: EMAIL_VERIFICATION_SENT})
	@ApiResponse({
		status: 400,
		description: 'If newEmail is missing or is not a valid email address of at most 255 characters.',
	})
	@ApiResponse({status: 401, description: UNAUTHORIZED})
	@ApiResponse({
		status: 403,
		description:
			'Forbidden if the account email is unverified or the request Origin is missing, invalid, or does not match the configured web origin.',
	})
	@ApiResponse({status: 409, description: EMAIL_ALREADY_IN_USE})
	@ApiResponse({status: 429, description: TOO_MANY_REQUESTS})
	@ApiOperation({summary: "Requests a change to the account's email."})
	async requestEmailChange(@CurrentAccount() account: Account, @Body() dto: EmailChangeRequestDto) {
		return await this.emailVerifierService.requestEmailChange(account, dto.newEmail);
	}

	@Post('change-email/verify')
	@UseGuards(CsrfOriginGuard)
	@HttpCode(200)
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	@ApiResponse({status: 200, description: EMAIL_CHANGE_SUCCESS})
	@ApiResponse({status: 400, description: EMAIL_INVALID_TOKEN})
	@ApiResponse({status: 401, description: UNAUTHORIZED})
	@ApiResponse({
		status: 403,
		description:
			'Forbidden if the account email is unverified or the request Origin is missing, invalid, or does not match the configured web origin.',
	})
	@ApiResponse({status: 409, description: EMAIL_ALREADY_IN_USE})
	@ApiResponse({status: 429, description: TOO_MANY_REQUESTS})
	@ApiOperation({summary: 'Verifies the new email using a token.'})
	async verifyEmailChange(@CurrentAccount() account: Account, @Body() dto: EmailChangeVerifyDto) {
		return await this.emailVerifierService.verifyEmailChange(account, dto.token, dto.email);
	}

	@Post('change-password')
	@HttpCode(200)
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	@ApiResponse({status: 200, description: PASSWORD_CHANGE_SUCCESS})
	@ApiResponse({status: 401, description: UNAUTHORIZED})
	@ApiResponse({status: 429, description: TOO_MANY_REQUESTS})
	@ApiOperation({summary: 'Changes the password for the current account.'})
	async changePassword(@CurrentAccount() account: Account, @Body() dto: PasswordChangeDto, @Req() request: Request) {
		return await this.authService.changePassword(account, dto, request.session.id);
	}

	@Public()
	@Post('reset-password/request')
	@HttpCode(200)
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	@ApiResponse({status: 200, description: PASSWORD_RESET_CONFIRMATION})
	@ApiResponse({status: 429, description: TOO_MANY_REQUESTS})
	@ApiOperation({summary: 'Requests a password reset via email.'})
	async requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
		return this.passwordResetService.requestPasswordReset(dto.email);
	}

	@Public()
	@Post('reset-password/verify')
	@HttpCode(200)
	@Throttle({default: {limit: 5, ttl: minutes(1)}})
	@ApiResponse({status: 200, description: PASSWORD_RESET_SUCCESS})
	@ApiResponse({status: 400, description: PASSWORD_RESET_INVALID_TOKEN})
	@ApiResponse({status: 429, description: TOO_MANY_REQUESTS})
	@ApiOperation({summary: 'Resets a password using a token.'})
	async resetPassword(@Body() dto: PasswordResetVerifyDto) {
		return this.passwordResetService.resetPassword(dto.newPassword, dto.token);
	}

	@Get('sessions')
	@HttpCode(200)
	@ApiResponse({status: 200, type: [SessionResponseDto]})
	@ApiResponse({status: 401, description: UNAUTHORIZED})
	@ApiResponse({status: 429, description: TOO_MANY_REQUESTS})
	@ApiOperation({summary: 'Retrieves all active sessions for the current account.'})
	async getSessions(@CurrentAccount() account: Account, @Req() request: Request) {
		return await this.sessionService.getSessions(account.id, request.session.id);
	}

	@Delete('sessions/:sessionId')
	@HttpCode(200)
	@ApiResponse({status: 200, description: SESSION_REVOKE_SUCCESS})
	@ApiResponse({status: 401, description: UNAUTHORIZED})
	@ApiResponse({status: 404, description: INVALID_SESSION})
	@ApiResponse({status: 409, description: CANNOT_REVOKE_CURRENT_SESSION})
	@ApiResponse({status: 429, description: TOO_MANY_REQUESTS})
	@ApiOperation({summary: 'Revokes a session.'})
	async revokeSession(@CurrentAccount() account: Account, @Req() request: Request, @Param() dto: SessionRevokeDto) {
		return await this.sessionService.revokeSession(account.id, request.session.id, dto.sessionId);
	}

	@Delete('sessions')
	@HttpCode(200)
	@Throttle({default: {limit: 6, ttl: minutes(1)}})
	@ApiResponse({status: 200, description: `${ALL_OTHER_SESSIONS_REVOKED} or ${NO_OTHER_SESSIONS_TO_REVOKE}`})
	@ApiResponse({status: 401, description: UNAUTHORIZED})
	@ApiResponse({status: 429, description: TOO_MANY_REQUESTS})
	@ApiOperation({summary: 'Revokes all personal access tokens and all sessions except the current one.'})
	async revokeAllOtherSessions(@CurrentAccount() account: Account, @Req() request: Request) {
		return await this.sessionService.revokeAllOtherSessions(account.id, request.session.id);
	}
}
