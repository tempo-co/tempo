import {Injectable, Logger} from '@nestjs/common';

import {ConfigurationService} from '@core/config/config.service';
import {EmailService} from '@core/email/email.service';
import {dateInAppTimeZone} from '@core/time/app-time-zone';

export type OperatorAlert = {
	/** What the alert is about, as a stable name with no data in it: alerts of one kind go out at most once a day. */
	kind: string;
	subject: string;
	text: string;
};

/**
 * Emails the operator address (`OPERATOR_ALERT_EMAIL`) about what no user sees (failures, the bank coverage digest),
 * at most once a day per kind.
 * The email job's id names the kind and the day, so the email queue in Redis drops a repeat across restarts and
 * instances. Without an address nothing is sent, and a send that fails is logged, never thrown at the caller.
 * Resolves true when the email was queued.
 */
@Injectable()
export class OperatorAlertService {
	private readonly logger = new Logger(OperatorAlertService.name);

	constructor(
		private readonly emailService: EmailService,
		private readonly configurationService: ConfigurationService,
	) {}

	async send({kind, subject, text}: OperatorAlert, now = new Date()): Promise<boolean> {
		const to = this.configurationService.get('OPERATOR_ALERT_EMAIL');
		if (!to) return false;
		const jobId = `operator-alert-${kind.replace(/[^A-Za-z0-9_-]/g, '_')}-${dateInAppTimeZone(now)}`;
		try {
			await this.emailService.send({to, subject, text}, undefined, jobId);
			return true;
		} catch (error) {
			const errorName = error instanceof Error && error.name.length > 0 ? error.name : 'UnknownError';
			this.logger.warn(`Operator alert ${kind} could not be queued: ${errorName}`);
			return false;
		}
	}
}
