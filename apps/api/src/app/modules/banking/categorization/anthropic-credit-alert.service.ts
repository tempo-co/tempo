import {Inject, Injectable, Logger} from '@nestjs/common';
import Redis from 'ioredis';

import {ConfigurationService} from '@core/config/config.service';
import {EmailService} from '@core/email/email.service';
import {REDIS} from '@core/redis/redis.constants';

import {safeErrorName} from '../banking.utils';

export const CREDIT_ALERT_SENT_KEY = 'ai-credit-alert:sent';
export const CREDIT_ALERT_PAUSED_KEY = 'ai-credit-alert:paused';
export const CREDIT_ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const CREDIT_PAUSED_SUBJECT = 'AI categorization paused: Anthropic credit balance is empty';
export const CREDIT_RESUMED_SUBJECT = 'AI categorization resumed: Anthropic API calls succeed again';

const PAUSED_TEXT =
	"The Anthropic API refuses Tempo's calls because the credit balance is empty. New transactions stay pending " +
	'and are categorized once calls succeed again. Add credit to the Anthropic account whose key Tempo uses.';
const RESUMED_TEXT = 'Anthropic API calls succeed again, so Tempo categorizes the pending transactions.';

// Starts a day's alert and marks the pause in one step. Returns the time of the day's alert and whether this call
// started it.
const PAUSE_SCRIPT = `if redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX') then
	redis.call('SET', KEYS[2], ARGV[1])
	return {ARGV[1], 1}
end
return {redis.call('GET', KEYS[1]), 0}`;

// Ends the pause unless a newer alert replaced it meanwhile.
const RESUME_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then
	return redis.call('DEL', KEYS[1])
end
return 0`;

/**
 * Tells the operator when AI calls stop because the Anthropic credit balance is exhausted, and once more when a call
 * succeeds again. Credit is shared by every account, so the alert goes to `OPERATOR_ALERT_EMAIL`, never to users;
 * without that address the alert is only logged. Redis holds the state, so an API restart neither repeats nor drops
 * an alert: at most one pause alert per day, and one recovery note per pause alert. Each email's job id comes from
 * the alert's time, so queueing it again after a failure or a restart still sends it once.
 */
@Injectable()
export class AnthropicCreditAlert {
	private readonly logger = new Logger(AnthropicCreditAlert.name);
	private readonly recipient?: string;

	constructor(
		@Inject(REDIS) private readonly redis: Redis,
		private readonly emailService: EmailService,
		configurationService: ConfigurationService,
	) {
		this.recipient = configurationService.get('OPERATOR_ALERT_EMAIL');
	}

	/** A call was refused because the credit balance is exhausted. Never throws. */
	async creditExhausted(): Promise<void> {
		try {
			const [alertedAt, started] = (await this.redis.eval(
				PAUSE_SCRIPT,
				2,
				CREDIT_ALERT_SENT_KEY,
				CREDIT_ALERT_PAUSED_KEY,
				String(Date.now()),
				String(CREDIT_ALERT_INTERVAL_MS),
			)) as [string | null, number];
			if (started) this.logger.warn(CREDIT_PAUSED_SUBJECT);
			// Queues the day's alert again: a no-op once it is queued, a retry when queueing it failed.
			if (alertedAt) await this.notify(CREDIT_PAUSED_SUBJECT, PAUSED_TEXT, `ai-credit-paused-${alertedAt}`);
		} catch (error) {
			this.logger.warn(`Credit alert failed: ${safeErrorName(error)}`);
		}
	}

	/** A call got an answer. Sends the recovery note when a pause alert is outstanding. Never throws. */
	async callSucceeded(): Promise<void> {
		try {
			const pausedAt = await this.redis.get(CREDIT_ALERT_PAUSED_KEY);
			if (!pausedAt) return;
			// Both are queued before the pause ends, so a failure leaves them to the next answered call. The pause alert is
			// a no-op once queued, and goes out first when queueing it failed.
			await this.notify(CREDIT_PAUSED_SUBJECT, PAUSED_TEXT, `ai-credit-paused-${pausedAt}`);
			await this.notify(CREDIT_RESUMED_SUBJECT, RESUMED_TEXT, `ai-credit-resumed-${pausedAt}`);
			if (await this.redis.eval(RESUME_SCRIPT, 1, CREDIT_ALERT_PAUSED_KEY, pausedAt))
				this.logger.log(CREDIT_RESUMED_SUBJECT);
		} catch (error) {
			this.logger.warn(`Credit recovery note failed: ${safeErrorName(error)}`);
		}
	}

	private async notify(subject: string, text: string, jobId: string): Promise<void> {
		if (this.recipient) await this.emailService.send({to: this.recipient, subject, text}, undefined, jobId);
	}
}
