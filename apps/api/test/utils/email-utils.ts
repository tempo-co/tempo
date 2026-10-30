import ms from 'ms';

import {Account} from '@modules/account/account.entity';

import {MailpitMessageSummaryResponse, MailpitResponse} from '../types/mailpit';
import {SIX_DIGIT_REGEX, UUID_REGEX} from '../types/regex.constants';

const EMAIL_FOOTER = 'Sent by Tempo because of activity on your account. Need help? Reply to this email.';

export class EmailUtils {
	static async clearEmails(apiUrl: string) {
		await fetch(`${apiUrl}/api/v1/messages`, {method: 'DELETE'});
	}

	static async findEmailByRecipient(recipientEmail: string, apiUrl: string, subject?: string) {
		let retries = 10;
		const delayMs = 200;

		// retry briefly to allow BullMQ to process the job and send email to Mailpit
		while (retries > 0) {
			const res = await fetch(`${apiUrl}/api/v1/messages`);
			const data = (await res.json()) as MailpitResponse;
			const email = data.messages.find((msg) => {
				const isRecipient = msg.To.some((r) => r.Address.toLowerCase() === recipientEmail.toLowerCase());
				return isRecipient && (!subject || msg.Subject === subject);
			});

			if (email) {
				const res = await fetch(`${apiUrl}/api/v1/message/${email.ID}`);
				const fullEmail = (await res.json()) as MailpitMessageSummaryResponse;
				return fullEmail;
			}

			retries--;
			if (retries > 0) await this._sleep(delayMs);
		}
	}

	static async getVerificationCode(recipientEmail: string, apiUrl: string) {
		const email = await this.findEmailByRecipient(recipientEmail, apiUrl);
		const code = this.extractCode(email?.Text);
		expect(code).toMatch(/^\d{6}$/);
		return code;
	}

	static async getToken(recipientEmail: string, apiUrl: string) {
		const email = await this.findEmailByRecipient(recipientEmail, apiUrl);
		const token = this.extractToken(email?.Text);
		expect(token).toMatch(new RegExp(`^${UUID_REGEX.source}$`));
		return token;
	}

	static extractCode(body?: string) {
		if (!body) return '';
		const pattern = new RegExp(`You can also manually enter the code below.?\\s*(${SIX_DIGIT_REGEX.source})`, 'i');
		const match = body.match(pattern);
		return match ? match[1] : '';
	}

	static extractToken(body?: string): string {
		if (!body) return '';
		// decode the quoted-printable encoding and handle soft line breaks
		const decodedBody = body.replace(/=3D/g, '=').replace(/=\r?\n/g, '');

		const pattern = new RegExp(`[?&]token=(${UUID_REGEX.source})`, 'i');
		const match = decodedBody.match(pattern);
		return match ? match[1] : '';
	}

	static normalizeEmailText(text?: string) {
		if (!text) return '';
		// remove all asterisk characters
		let cleaned = text.replace(/\*/g, '');
		// normalize all newline types
		cleaned = cleaned.replace(/\r\n/g, '\n');
		// remove all blank lines
		cleaned = cleaned.replace(/\n+/g, '\n');
		return cleaned.trim();
	}

	static getWelcomeEmailBody(
		email: Account['email'],
		name: Account['name'],
		webUrl: string,
		code: string,
		expiration: string,
	) {
		const ex = ms(ms(expiration as ms.StringValue), {long: true});

		return `Welcome to Tempo, ${name}
Confirm your email address to finish signing up.
Confirm email ( ${webUrl}/verify-email?email=${encodeURIComponent(email)}&code=${code} )
The link and code expire in ${ex}. You can also manually enter the code below.
${code}
If you didn't sign up for Tempo, you can ignore this email.
${EMAIL_FOOTER}`;
	}

	static getPasswordResetEmailBody(email: Account['email'], webUrl: string, token: string, expiration: string) {
		const ex = ms(ms(expiration as ms.StringValue), {long: true});

		return `Reset your Tempo password
You asked to reset your Tempo password. Use the button below to choose a new one.
Reset password ( ${webUrl}/reset-password?email=${encodeURIComponent(email)}&token=${token} )
This link expires in ${ex}.
If you didn't ask for this, you can ignore this email. Your password stays the same.
${EMAIL_FOOTER}`;
	}

	static getVerifyNewEmailBody(email: Account['email'], webUrl: string, token: string, expiration: string) {
		const ex = ms(ms(expiration as ms.StringValue), {long: true});

		return `Confirm your new email
You asked to use this address for your Tempo account. Confirm it to finish the change.
Confirm email ( ${webUrl}/verify-email-change?email=${encodeURIComponent(email)}&token=${token} )
This link expires in ${ex}. Your current email keeps working until you confirm.
If you didn't ask for this, you can ignore this email.
${EMAIL_FOOTER}`;
	}

	static getEmailChangedBody(name: Account['name'], oldEmail: Account['email'], newEmail: Account['email']) {
		return `Your Tempo email was changed, ${name}
You now sign in with ${newEmail} instead of ${oldEmail}.
If you didn't make this change, reset your password and reply to this email right away.
${EMAIL_FOOTER}`;
	}

	private static _sleep(ms: number = 250) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
