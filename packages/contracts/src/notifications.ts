/** Which alerts the owner's devices receive. Both are on until the owner turns one off. */
export type NotificationPreferences = {
	/** A bank needs re-authorizing soon, or has stopped syncing. */
	bankConnections: boolean;
	/** A recurring bill is late, or higher than usual. */
	recurringBills: boolean;
};

/** `GET /notifications` */
export type NotificationSettings = {
	/** The server's VAPID public key (base64url) for `PushManager.subscribe`; null when it can't send push. */
	publicKey: string | null;
	preferences: NotificationPreferences;
};

/** `PATCH /notifications/preferences` body. */
export type NotificationPreferencesUpdate = Partial<NotificationPreferences>;

/** `PUT /notifications/subscriptions` body: `PushSubscription.toJSON()` from the browser. */
export type PushSubscriptionRegistration = {
	endpoint: string;
	keys: {p256dh: string; auth: string};
};

/** `DELETE /notifications/subscriptions` body. */
export type PushSubscriptionRemoval = {
	endpoint: string;
};
