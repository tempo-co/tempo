import {BullModule} from '@nestjs/bullmq';
import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';

import {PUSH_NOTIFICATION_QUEUE} from '@core/queue/queue.constants';
import {SessionModule} from '@core/session/session.module';

import {NotificationController} from './api/notification.controller';
import {PushNotificationService} from './push-notification.service';
import {PushPreferences} from './push-preferences.entity';
import {PushSubscription} from './push-subscription.entity';
import {WebPushSender} from './web-push.sender';

/**
 * Web Push subscriptions, alert choices and delivery. Features that raise alerts import it and run the delivery
 * worker themselves, since only they can tell whether an alert still applies.
 */
@Module({
	imports: [
		TypeOrmModule.forFeature([PushSubscription, PushPreferences]),
		BullModule.registerQueue({name: PUSH_NOTIFICATION_QUEUE}),
		SessionModule,
	],
	providers: [PushNotificationService, WebPushSender],
	controllers: [NotificationController],
	exports: [PushNotificationService],
})
export class NotificationsModule {}
