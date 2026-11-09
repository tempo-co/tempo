import {Body, Controller, Delete, Get, HttpCode, Patch, Put, Req, UseGuards} from '@nestjs/common';
import type {NotificationSettings} from '@tempo/contracts';
import {Request} from 'express';

import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';
import {CsrfOriginGuard} from '@modules/auth/guards/csrf-origin.guard';

import {PushNotificationService} from '../push-notification.service';
import {
	NotificationPreferencesUpdateDto,
	PushSubscriptionRegistrationDto,
	PushSubscriptionRemovalDto,
} from './notification.dto';

/** Push alerts: the owner's choices, and this browser's subscription. Signed-in sessions only. */
@Controller('notifications')
export class NotificationController {
	constructor(private readonly pushNotificationService: PushNotificationService) {}

	@Get()
	getSettings(@CurrentAccount() account: Account): Promise<NotificationSettings> {
		return this.pushNotificationService.getSettings(account.id);
	}

	@Patch('preferences')
	@UseGuards(CsrfOriginGuard)
	updatePreferences(
		@CurrentAccount() account: Account,
		@Body() dto: NotificationPreferencesUpdateDto,
	): Promise<NotificationSettings> {
		return this.pushNotificationService.updatePreferences(account.id, dto);
	}

	@Put('subscriptions')
	@HttpCode(204)
	@UseGuards(CsrfOriginGuard)
	async register(
		@CurrentAccount() account: Account,
		@Req() request: Request,
		@Body() dto: PushSubscriptionRegistrationDto,
	): Promise<void> {
		await this.pushNotificationService.register(account.id, request.session.id, dto);
	}

	@Delete('subscriptions')
	@HttpCode(204)
	@UseGuards(CsrfOriginGuard)
	async remove(@CurrentAccount() account: Account, @Body() dto: PushSubscriptionRemovalDto): Promise<void> {
		await this.pushNotificationService.remove(account.id, dto.endpoint);
	}
}
