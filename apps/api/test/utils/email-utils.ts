import {getQueueToken} from '@nestjs/bullmq';
import {Queue} from 'bullmq';
import ms from 'ms';

import type {EmailJobData} from '@core/email/email.service';
import {EMAIL_QUEUE} from '@core/queue/queue.constants';
import {Account} from '@modules/account/account.entity';

import {getApp} from '../setup/e2e.setup';
import {MailpitMessageSummaryResponse, MailpitResponse} from '../types/mailpit';
import {SIX_DIGIT_REGEX, UUID_REGEX} from '../types/regex.constants';
import {waitFor} from './wait-utils';

/** Mailpit's HTTP API on the host port `scripts/e2e-stack.mjs` passes as `EMAIL_UI_PORT`. */
export const MAILPIT_API_URL = `http://127.0.0.1:${process.env.EMAIL_UI_PORT ?? '8025'}`;

const PENDING_EMAIL_STATES = ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'] as const;

/** A single email normally leaves the queue in under 100 ms; past this, the wait is logged, early enough to fit Jest's 5 s timeout. */
const SLOW_EMAIL_QUEUE_MS = 1_000;

const isEmpty = (counts: Record<string, number>) => Object.values(counts).every((count) => count === 0);

const EMAIL_FOOTER = 'Sent by Tempo because of activity on your account. Need help? Reply to this email.';

export class EmailUtils {
	static async clearEmails(apiUrl: string) {
		await fetch(`${apiUrl}/api/v1/messages`, {method: 'DELETE'});
	}

	static async findEmailByRecipient(recipientEmail: string, apiUrl: string, subject?: string) {
		await this.waitForEmailQueue();
		const res = await fetch(`${apiUrl}/api/v1/messages`);
		const data = (await res.json()) as MailpitResponse;
		const email = data.messages.find((msg) => {
			const isRecipient = msg.To.some((r) => r.Address.toLowerCase() === recipientEmail.toLowerCase());
			return isRecipient && (!subject || msg.Subject === subject);
		});
		if (!email) return undefined;

		const fullEmail = await fetch(`${apiUrl}/api/v1/message/${email.ID}`);
		return (await fullEmail.json()) as MailpitMessageSummaryResponse;
	}

	/**
	 * Resolves once the email queue has sent, or given up on, every email queued so far, so Mailpit holds every email
	 * the earlier requests asked for.
	 */
	private static async waitForEmailQueue() {
		const queue = getApp().get<Queue<EmailJobData>>(getQueueToken(EMAIL_QUEUE));
		const startedAt = Date.now();
		let reported = false;
		await waitFor(async () => {
			const counts = await queue.getJobCounts(...PENDING_EMAIL_STATES);
			if (!reported && !isEmpty(counts) && Date.now() - startedAt > SLOW_EMAIL_QUEUE_MS) {
				reported = true;
				await this.reportPendingEmails(queue);
			}
			return counts;
		}, isEmpty);
	}

	/**
	 * Logs the jobs still holding the queue, so a slow run's CI log shows whether a send is stuck, retrying or not
	 * picked up, even when Jest's timeout ends the test first.
	 */
	private static async reportPendingEmails(queue: Queue<EmailJobData>) {
		const now = Date.now();
		const jobs = await queue.getJobs([...PENDING_EMAIL_STATES]);
		const details = await Promise.all(
			jobs.map(async (job) => ({
				state: await job.getState(),
				subject: job.data.subject,
				attemptsMade: job.attemptsMade,
				failedReason: job.failedReason,
				queuedMsAgo: now - job.timestamp,
				startedMsAgo: job.processedOn ? now - job.processedOn : undefined,
			})),
		);
		console.warn(
			`${expect.getState().currentTestName}: email queue still busy after ${SLOW_EMAIL_QUEUE_MS} ms`,
			JSON.stringify(details),
		);
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
}
