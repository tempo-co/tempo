/** `GET /accounts/me`, also returned by signup, login and `PATCH /accounts/me`. */
export type Account = {
	id: string;
	name: string;
	email: string;
	isEmailVerified: boolean;
	/** The reporting currency (`GET /reporting-currency`); null until one is set. */
	baseCurrency: string | null;
	/** IANA name of the owner's time zone (`Europe/Lisbon`); alert quiet hours and the MCP default date follow it. */
	timeZone: string;
	createdAt: string;
	updatedAt: string;
};

/** `PATCH /accounts/me`: the fields to change. */
export type AccountUpdateRequest = {
	name?: string;
	/** An IANA name the API supports, or `UTC`; anything else is a 400. */
	timeZone?: string;
};

/** `DELETE /accounts/me` */
export type AccountDeleteRequest = {
	password: string;
};

/** The confirmation most account, auth and session actions return. */
export type MessageResponse = {
	message: string;
};
