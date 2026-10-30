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
