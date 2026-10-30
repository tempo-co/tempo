import {Injectable} from '@nestjs/common';
import {Request} from 'express';

import {SessionService} from '@core/session/session.service';
import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';

import {LOGIN_SUCCESS, LOGOUT_SUCCESS, PASSWORD_CHANGE_SUCCESS} from '../api/constants/api-messages.constants';
import {PasswordChangeDto} from '../api/dtos/password-change.dto';
import {SignUpDto} from '../api/dtos/signup.dto';
import {EmailVerifierService} from './email-verifier.service';

@Injectable()
export class AuthService {
	constructor(
		private readonly emailVerifierService: EmailVerifierService,
		private readonly accountService: AccountService,
		private readonly sessionService: SessionService,
	) {}

	async signUp({name, email, password}: SignUpDto, request: Request) {
		await this.accountService.validateEmailIsUnique(email);

		const hash = await this.accountService.hashPassword(password);
		const account = await this.accountService.save(name, email, hash);

		await this.emailVerifierService.sendWelcomeEmail(account);
		await this.logIn(account, request);
		return account;
	}

	async logOut(request: Request) {
		await new Promise<void>((resolve) => {
			request.logOut({keepSessionInfo: false}, () => {
				resolve();
			});
			request.session.destroy(() => {
				resolve();
			});
		});
		return {message: LOGOUT_SUCCESS};
	}

	async logIn(account: Account, request: Request) {
		await new Promise<void>((resolve) => {
			request.logIn(account, () => {
				resolve();
			});
		});
		await this.sessionService.initializeSessionMetadata(request);
		return {message: LOGIN_SUCCESS};
	}

	async changePassword(account: Account, dto: PasswordChangeDto, currentSessionId: string) {
		await this.accountService.verifyPassword(account.password, dto.currentPassword);

		const hash = await this.accountService.hashPassword(dto.newPassword);
		await this.accountService.updateFields(account.id, {password: hash});
		await this.sessionService.revokeAllOtherSessions(account.id, currentSessionId);
		return {message: PASSWORD_CHANGE_SUCCESS};
	}
}
