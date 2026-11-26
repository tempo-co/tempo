import {InjectQueue} from '@nestjs/bullmq';
import {Injectable, Logger, OnModuleInit} from '@nestjs/common';
import {InjectDataSource} from '@nestjs/typeorm';
import {BANK_LIST, OTHER_BANK_ID} from '@tempo/contracts';
import {Queue} from 'bullmq';
import {DataSource} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {OperatorAlertService} from '@core/operator-alert/operator-alert.service';
import {bootstrapJobScheduler} from '@core/queue/job-scheduler';
import {
	BANK_COVERAGE_DIGEST_QUEUE,
	BANK_COVERAGE_DIGEST_SCHEDULER_ID,
	SEND_BANK_COVERAGE_DIGEST_JOB,
} from '@core/queue/queue.constants';

const DAY_MS = 24 * 60 * 60 * 1000;
const VERIFIED_BANK_IDS = BANK_LIST.filter((bank) => bank.status === 'verified').map((bank) => bank.id);
const BANK_NAMES = new Map(BANK_LIST.map((bank) => [bank.id, bank.name]));

type NewBank = {label: string; country: string | null; accounts: number; hasLayout: boolean};
type MissedBank = {bankId: string; misses: number; accounts: number};

/**
 * Emails the operator, once a day, the banks a user asked for or confirmed a mapper layout under for the first time
 * the previous UTC day, and the verified banks whose files missed their own readers that day. A bank is new on the
 * day of its first request or layout, so it is listed once. Counts and bank names only.
 */
@Injectable()
export class BankCoverageDigestService implements OnModuleInit {
	private readonly logger = new Logger(BankCoverageDigestService.name);

	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		@InjectQueue(BANK_COVERAGE_DIGEST_QUEUE) private readonly queue: Queue,
		private readonly operatorAlertService: OperatorAlertService,
		private readonly configurationService: ConfigurationService,
	) {}

	async onModuleInit(): Promise<void> {
		await bootstrapJobScheduler(
			this.queue,
			{
				schedulerId: BANK_COVERAGE_DIGEST_SCHEDULER_ID,
				jobName: SEND_BANK_COVERAGE_DIGEST_JOB,
				pattern: '0 6 * * *',
			},
			{
				enabled:
					this.configurationService.get('FILE_IMPORT_ENABLED') === true &&
					Boolean(this.configurationService.get('OPERATOR_ALERT_EMAIL')),
				configurationService: this.configurationService,
				logger: this.logger,
			},
		);
	}

	/** Sends the digest of the UTC day before `now`; a day with nothing to report sends nothing. */
	async send(now = new Date()): Promise<void> {
		const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
		const start = new Date(end.getTime() - DAY_MS);
		const [newBanks, missedBanks] = await Promise.all([this.newBanks(start, end), this.missedBanks(start, end)]);
		if (newBanks.length === 0 && missedBanks.length === 0) return;

		const day = start.toISOString().slice(0, 10);
		const lines = [`Bank coverage on ${day} (UTC).`];
		if (newBanks.length > 0)
			lines.push(
				'',
				'Asked for or mapped for the first time:',
				...newBanks.map(
					(bank) =>
						`- ${bank.label}${bank.country ? ` (${bank.country})` : ''}: ${accounts(bank.accounts)}, ` +
						(bank.hasLayout ? 'a saved layout to build from' : 'no saved layout yet'),
				),
			);
		if (missedBanks.length > 0)
			lines.push(
				'',
				'Verified banks whose files their own readers did not read:',
				...missedBanks.map(
					(bank) =>
						`- ${BANK_NAMES.get(bank.bankId) ?? bank.bankId} (${bank.bankId}): ` +
						`${bank.misses} ${bank.misses === 1 ? 'miss' : 'misses'} from ${accounts(bank.accounts)}`,
				),
			);
		await this.operatorAlertService.send(
			{kind: 'bank-coverage', subject: 'Tempo: banks to add', text: lines.join('\n')},
			now,
		);
	}

	/**
	 * Banks whose first request or confirmed mapper layout falls in the window. A request or a layout under "Another
	 * bank" names its bank by the typed name, case and spacing aside; a layout under an unverified listed bank by its
	 * id. Layouts under a verified bank are misses of it instead.
	 */
	private async newBanks(start: Date, end: Date): Promise<NewBank[]> {
		const rows = await this.dataSource.query<
			{bankId: string | null; label: string; country: string | null; accounts: string; hasLayout: boolean}[]
		>(
			`SELECT min("bankId") AS "bankId", (array_agg(label ORDER BY "createdAt"))[1] AS label, min(country) AS country,
				count(DISTINCT "accountId") AS accounts,
				bool_or("fromLayout") AS "hasLayout"
			FROM (
				SELECT 'name:' || lower(btrim("bankName")) || ':' || country AS key, NULL AS "bankId", btrim("bankName") AS label,
					country, "accountId", "createdAt", false AS "fromLayout"
				FROM bank_requests
				UNION ALL
				SELECT CASE WHEN "bankId" = $3 THEN 'name:' || lower(btrim("bankName")) ELSE 'bank:' || "bankId" END,
					NULLIF("bankId", $3), btrim("bankName"), NULL, "accountId", "createdAt", true
				FROM bank_import_layouts
				WHERE "bankId" IS NOT NULL AND NOT ("bankId" = ANY($4))
			) events
			GROUP BY key
			HAVING min("createdAt") >= $1 AND min("createdAt") < $2
			ORDER BY lower((array_agg(label ORDER BY "createdAt"))[1])`,
			[start, end, OTHER_BANK_ID, VERIFIED_BANK_IDS],
		);
		return rows.map(({bankId, label, country, accounts, hasLayout}) => {
			const listed = BANK_LIST.find((bank) => bank.id === bankId);
			return {
				label: listed?.name ?? label,
				country: listed ? listed.country : country,
				accounts: Number(accounts),
				hasLayout,
			};
		});
	}

	private async missedBanks(start: Date, end: Date): Promise<MissedBank[]> {
		const rows = await this.dataSource.query<{bankId: string; misses: string; accounts: string}[]>(
			`SELECT "bankId", count(*) AS misses, count(DISTINCT "accountId") AS accounts
			FROM bank_import_layout_misses
			WHERE "createdAt" >= $1 AND "createdAt" < $2
			GROUP BY "bankId"
			ORDER BY "bankId"`,
			[start, end],
		);
		return rows.map((row) => ({bankId: row.bankId, misses: Number(row.misses), accounts: Number(row.accounts)}));
	}
}

function accounts(count: number): string {
	return `${count} ${count === 1 ? 'account' : 'accounts'}`;
}
