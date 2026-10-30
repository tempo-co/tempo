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
