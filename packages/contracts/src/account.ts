/** `GET /accounts/me`, also returned by signup, login and `PATCH /accounts/me`. */
export type Account = {
	id: string;
	name: string;
	email: string;
	isEmailVerified: boolean;
	/** Null until the owner's first conversion run has picked a base currency. */
	baseCurrency: string | null;
	createdAt: string;
	updatedAt: string;
};

/** `PATCH /accounts/me` */
export type AccountUpdateRequest = {
	name: string;
};

/** `DELETE /accounts/me` */
export type AccountDeleteRequest = {
	password: string;
};

/** The confirmation most account, auth and session actions return. */
export type MessageResponse = {
	message: string;
};
