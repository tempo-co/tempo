/** `POST /auth/signup` */
export type SignUpRequest = {
	name: string;
	email: string;
	password: string;
};

/** `POST /auth/login` */
export type LogInRequest = {
	email: string;
	password: string;
};

/** `POST /auth/signup/verify` */
export type EmailVerifyRequest = {
	/** Six digits. */
	code: string;
	email: string;
};

/** `HEAD /auth/change-email/check` */
export type EmailCheckQuery = {
	email: string;
};

/** `POST /auth/change-email/request` */
export type EmailChangeRequest = {
	newEmail: string;
};

/** `POST /auth/change-email/verify` */
export type EmailChangeVerifyRequest = {
	token: string;
	email: string;
};

/** `POST /auth/change-password` */
export type PasswordChangeRequest = {
	currentPassword: string;
	newPassword: string;
};

/** `POST /auth/reset-password/request` */
export type PasswordResetRequest = {
	email: string;
};

/** `POST /auth/reset-password/verify` */
export type PasswordResetVerifyRequest = {
	token: string;
	newPassword: string;
};

/** One entry of `GET /auth/sessions`. Unknown metadata reads `Unknown`. */
export type Session = {
	id: string;
	ip: string;
	deviceType: string;
	browserType: string;
	name: string;
	location: string;
	createdAt: string;
	lastSeenAt: string;
	isCurrent: boolean;
};

/** Days a new personal access token lives; null keeps it until revoked. */
export const PERSONAL_ACCESS_TOKEN_LIFETIMES = [30, 90, 365] as const;
export type PersonalAccessTokenLifetime = (typeof PERSONAL_ACCESS_TOKEN_LIFETIMES)[number];

export const PERSONAL_ACCESS_TOKEN_SCOPES = ['read'] as const;
export type PersonalAccessTokenScope = (typeof PERSONAL_ACCESS_TOKEN_SCOPES)[number];

/** One entry of `GET /personal-access-tokens`. */
export type PersonalAccessToken = {
	id: string;
	name: string;
	prefix: string;
	scopes: PersonalAccessTokenScope[];
	createdAt: string;
	lastUsedAt: string | null;
	/** Null when the token never expires. */
	expiresAt: string | null;
};

/** `POST /personal-access-tokens`: the only response that carries the secret. */
export type CreatedPersonalAccessToken = PersonalAccessToken & {token: string};

/** `POST /personal-access-tokens` */
export type PersonalAccessTokenCreateRequest = {
	name: string;
	/** Omitted means 90. */
	expiresInDays?: PersonalAccessTokenLifetime | null;
};
