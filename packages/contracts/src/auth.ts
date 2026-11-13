/** `POST /auth/signup` */
export type SignUpRequest = {
	name: string;
	email: string;
	password: string;
	/** The browser's IANA time zone; a missing or unsupported one stores the default (`Europe/Amsterdam`). */
	timeZone?: string;
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
	/** Confirms the change, so a session alone cannot move the account to another inbox. */
	currentPassword: string;
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

/** Why `POST /auth/reset-password/verify` answered 400: the link is unknown, used or replaced, or the password is the current one. */
export type PasswordResetErrorCode = 'invalid_token' | 'password_unchanged';

/** An error body that names its cause; clients branch on `code`, never on `message`. */
export type CodedErrorResponse<Code extends string> = {
	statusCode: number;
	error: string;
	message: string;
	code: Code;
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
