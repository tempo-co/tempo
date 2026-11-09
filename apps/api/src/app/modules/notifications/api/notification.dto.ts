import type {
	NotificationPreferencesUpdate,
	PushSubscriptionRegistration,
	PushSubscriptionRemoval,
} from '@tempo/contracts';
import {Type} from 'class-transformer';
import {IsBoolean, IsObject, Matches, MaxLength, ValidateIf, ValidateNested} from 'class-validator';

/**
 * Hosts of the browsers' push services: Apple, Google (Chrome, Edge on Android), Mozilla and Microsoft. The API posts
 * to the endpoint it is given, so it accepts only these.
 */
const PUSH_SERVICE_ENDPOINT =
	/^https:\/\/(?:[a-z0-9-]+\.)*(?:push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\/\S+$/;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** The choice may be left out; when sent it must be true or false. */
export class NotificationPreferencesUpdateDto implements NotificationPreferencesUpdate {
	@ValidateIf((_dto, value) => value !== undefined)
	@IsBoolean()
	bankConnections?: boolean;
}

export class PushSubscriptionKeysDto {
	@MaxLength(128)
	@Matches(BASE64URL)
	p256dh: string;

	@MaxLength(64)
	@Matches(BASE64URL)
	auth: string;
}

export class PushSubscriptionRemovalDto implements PushSubscriptionRemoval {
	@MaxLength(2048)
	@Matches(PUSH_SERVICE_ENDPOINT)
	endpoint: string;
}

export class PushSubscriptionRegistrationDto
	extends PushSubscriptionRemovalDto
	implements PushSubscriptionRegistration
{
	@IsObject()
	@ValidateNested()
	@Type(() => PushSubscriptionKeysDto)
	keys: PushSubscriptionKeysDto;
}
