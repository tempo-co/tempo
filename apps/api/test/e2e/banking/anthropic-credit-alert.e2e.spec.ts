import {getQueueToken} from '@nestjs/bullmq';
import {INestApplication} from '@nestjs/common';
import {Queue} from 'bullmq';
import Redis from 'ioredis';

import {ConfigurationService} from '@core/config/config.service';
import {EmailService} from '@core/email/email.service';
import {EMAIL_QUEUE} from '@core/queue/queue.constants';
import {REDIS} from '@core/redis/redis.constants';
import {
	AnthropicCreditAlert,
	CREDIT_ALERT_PAUSED_KEY,
	CREDIT_ALERT_SENT_KEY,
	CREDIT_PAUSED_SUBJECT,
	CREDIT_RESUMED_SUBJECT,
} from '@modules/banking/categorization/anthropic-credit-alert.service';

import {getApp} from '../../setup/e2e.setup';
import {MailpitResponse} from '../../types/mailpit';
import {EmailUtils, MAILPIT_API_URL} from '../../utils/email-utils';

describe('Anthropic credit alert (e2e)', () => {
	let app: INestApplication;
	let alert: AnthropicCreditAlert;
	let redis: Redis;
	let emailQueue: Queue;
	let operatorEmail: string;

	beforeAll(() => {
		app = getApp();
		alert = app.get(AnthropicCreditAlert);
		redis = app.get(REDIS);
		emailQueue = app.get(getQueueToken(EMAIL_QUEUE));
		operatorEmail = app.get(ConfigurationService).get('OPERATOR_ALERT_EMAIL')!;
	});

	beforeEach(async () => {
		await redis.del(CREDIT_ALERT_SENT_KEY, CREDIT_ALERT_PAUSED_KEY);
		await EmailUtils.clearEmails(MAILPIT_API_URL);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('emails the operator once a day while credit is exhausted, and once when calls succeed again', async () => {
		const emailService = app.get(EmailService);
		// A restarted API reads the same Redis state.
		const restarted = new AnthropicCreditAlert(redis, emailService, app.get(ConfigurationService));
		const queue = emailService.send.bind(emailService);
		const send = jest.spyOn(emailService, 'send');

		// An alert that could not be queued goes out with the next refusal, even after a restart.
		send.mockRejectedValueOnce(new Error('synthetic queue failure'));
		await alert.creditExhausted();
		expect(await delivered()).toEqual({paused: 0, resumed: 0});
		await Promise.all([alert.creditExhausted(), alert.creditExhausted(), restarted.creditExhausted()]);
		expect(await delivered()).toEqual({paused: 1, resumed: 0});

		// Likewise a recovery note that could not be queued goes out with the next answered call.
		send.mockImplementationOnce(async (options, ...rest) => {
			// The pause alert is queued again first (a no-op); only the recovery note fails.
			await queue(options, ...rest);
			send.mockRejectedValueOnce(new Error('synthetic queue failure'));
		});
		await alert.callSucceeded();
		expect(await delivered()).toEqual({paused: 1, resumed: 0});
		expect(await redis.get(CREDIT_ALERT_PAUSED_KEY)).not.toBeNull();
		await Promise.all([restarted.callSucceeded(), restarted.callSucceeded()]);
		await alert.callSucceeded();
		expect(await delivered()).toEqual({paused: 1, resumed: 1});

		// Within the day, a new pause stays quiet and so does the success after it.
		await alert.creditExhausted();
		await alert.callSucceeded();
		expect(await delivered()).toEqual({paused: 1, resumed: 1});

		// A day after the last alert, an exhausted balance alerts again. When that alert could not be queued and the
		// next call already succeeds, it goes out together with its recovery note.
		await redis.del(CREDIT_ALERT_SENT_KEY);
		send.mockRejectedValueOnce(new Error('synthetic queue failure'));
		await alert.creditExhausted();
		expect(await redis.pttl(CREDIT_ALERT_SENT_KEY)).toBeGreaterThan(23 * 60 * 60 * 1000);
		await restarted.callSucceeded();
		expect(await delivered()).toEqual({paused: 2, resumed: 2});
	});

	/** Waits until the email worker has handed every queued email to Mailpit, then counts the operator's emails. */
	async function delivered(): Promise<{paused: number; resumed: number}> {
		for (let attempt = 0; attempt < 50; attempt++) {
			const counts = await emailQueue.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
			if (Object.values(counts).every((count) => count === 0)) break;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		const response = await fetch(`${MAILPIT_API_URL}/api/v1/messages?limit=50`);
		const {messages} = (await response.json()) as MailpitResponse;
		const subjects = messages
			.filter((message) => message.To.some((to) => to.Address === operatorEmail))
			.map((message) => message.Subject);
		return {
			paused: subjects.filter((subject) => subject === CREDIT_PAUSED_SUBJECT).length,
			resumed: subjects.filter((subject) => subject === CREDIT_RESUMED_SUBJECT).length,
		};
	}
});
