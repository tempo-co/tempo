import {InjectQueue} from '@nestjs/bullmq';
import {Inject, Injectable, Logger, OnModuleInit} from '@nestjs/common';
import {InjectDataSource} from '@nestjs/typeorm';
import {BANK_LIST, bankNameKey, bankNameSpelling} from '@wisp/contracts';
import {Queue} from 'bullmq';
import Redis from 'ioredis';
import {DataSource} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {OperatorAlertService} from '@core/operator-alert/operator-alert.service';
import {bootstrapJobScheduler} from '@core/queue/job-scheduler';
import {
	BANK_COVERAGE_DIGEST_QUEUE,
	BANK_COVERAGE_DIGEST_SCHEDULER_ID,
	SEND_BANK_COVERAGE_DIGEST_JOB,
} from '@core/queue/queue.constants';
import {REDIS} from '@core/redis/redis.constants';
import {dateInAppTimeZone} from '@core/time/app-time-zone';

/** The bank keys already emailed, and when the last digest was queued. */
const REPORTED_KEY = 'file-import:bank-coverage-digest:reported';
const LAST_SENT_KEY = 'file-import:bank-coverage-digest:last-sent-at';
const LISTED_BANKS = new Map(BANK_LIST.map((bank) => [bank.id, bank]));
const VERIFIED_NAME_KEYS = new Set(
	BANK_LIST.filter((bank) => bank.status === 'verified').map((bank) => bankNameKey(bank.name)),
);

type BankEvent = {
	bankId: string | null;
	bankName: string;
	country: string | null;
	accountId: string;
	fromLayout: boolean;
};
type NewBank = {key: string; label: string; countries: string[]; accounts: number; hasLayout: boolean};
type MissedBank = {bankId: string; misses: number; accounts: number};

/**
 * Emails the operator at most once a day: each bank that a request or a confirmed saved layout names and that no
 * digest listed before, and the verified banks whose files missed their own readers since the last digest. A bank is
 * its listed entry, or the typed name compared as `bankNameKey` does; a verified bank is listed only by its misses.
 * Redis keeps the banks already emailed and the last send, so a late or failed run is caught up by the next one.
 * Counts and bank names only.
 */
@Injectable()
export class BankCoverageDigestService implements OnModuleInit {
	private readonly logger = new Logger(BankCoverageDigestService.name);

	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		@InjectQueue(BANK_COVERAGE_DIGEST_QUEUE) private readonly queue: Queue,
		@Inject(REDIS) private readonly redis: Redis,
		private readonly operatorAlertService: OperatorAlertService,
		private readonly configurationService: ConfigurationService,
	) {}

	isEnabled(): boolean {
		return (
			this.configurationService.get('FILE_IMPORT_ENABLED') === true &&
			Boolean(this.configurationService.get('OPERATOR_ALERT_EMAIL'))
		);
	}

	async onModuleInit(): Promise<void> {
		await bootstrapJobScheduler(
			this.queue,
			{
				schedulerId: BANK_COVERAGE_DIGEST_SCHEDULER_ID,
				jobName: SEND_BANK_COVERAGE_DIGEST_JOB,
				pattern: '0 6 * * *',
			},
			{enabled: this.isEnabled(), configurationService: this.configurationService, logger: this.logger},
		);
	}

	/** Queues the digest unless one went out today or there is nothing new; marks what it listed as reported. */
	async send(now = new Date()): Promise<void> {
		if (!this.isEnabled()) return;
		const lastSent = await this.redis.get(LAST_SENT_KEY);
		const since = lastSent ? new Date(lastSent) : new Date(0);
		if (lastSent && dateInAppTimeZone(since) === dateInAppTimeZone(now)) return;

		const reported = new Set(await this.redis.smembers(REPORTED_KEY));
		const newBanks = (await this.banks()).filter((bank) => !reported.has(bank.key));
		const missedBanks = await this.missedBanks(since, now);
		if (newBanks.length === 0 && missedBanks.length === 0) return;

		const queued = await this.operatorAlertService.send(
			{kind: 'bank-coverage', subject: 'Wisp: banks to add', text: digestText(newBanks, missedBanks)},
			now,
		);
		if (!queued) return;
		if (newBanks.length > 0) await this.redis.sadd(REPORTED_KEY, ...newBanks.map((bank) => bank.key));
		await this.redis.set(LAST_SENT_KEY, now.toISOString());
	}

	/** Every bank a request or a confirmed saved layout names, with its accounts, except verified banks; across all accounts, as the operator digest counts them. */
	private async banks(): Promise<NewBank[]> {
		const events = await this.dataSource.query<BankEvent[]>(
			`SELECT NULL AS "bankId", "bankName", country, "accountId", false AS "fromLayout", "createdAt"
			FROM bank_requests
			UNION ALL
			SELECT "bankId", "bankName", NULL, "accountId", true, "createdAt"
			FROM bank_import_layouts
			ORDER BY "createdAt"`,
		);
		const banks = new Map<
			string,
			{label: string; countries: Set<string>; accounts: Set<string>; hasLayout: boolean}
		>();
		for (const event of events) {
			const listed = event.bankId ? LISTED_BANKS.get(event.bankId) : undefined;
			if (listed?.status === 'verified') continue;
			const label = listed?.name ?? bankNameSpelling(event.bankName);
			const key = bankNameKey(label);
			if (VERIFIED_NAME_KEYS.has(key)) continue;
			const bank = banks.get(key) ?? {label, countries: new Set(), accounts: new Set(), hasLayout: false};
			const country = listed?.country ?? event.country;
			if (country) bank.countries.add(country);
			bank.accounts.add(event.accountId);
			bank.hasLayout ||= event.fromLayout;
			banks.set(key, bank);
		}
		return [...banks]
			.map(([key, bank]) => ({
				key,
				label: bank.label,
				countries: [...bank.countries].sort(),
				accounts: bank.accounts.size,
				hasLayout: bank.hasLayout,
			}))
			.sort((a, b) => a.key.localeCompare(b.key));
	}

	private async missedBanks(since: Date, until: Date): Promise<MissedBank[]> {
		const rows = await this.dataSource.query<{bankId: string; misses: string; accounts: string}[]>(
			`SELECT "bankId", count(*) AS misses, count(DISTINCT "accountId") AS accounts
			FROM bank_import_layout_misses
			WHERE "createdAt" > $1 AND "createdAt" <= $2
			GROUP BY "bankId"
			ORDER BY "bankId"`,
			[since, until],
		);
		return rows.map((row) => ({bankId: row.bankId, misses: Number(row.misses), accounts: Number(row.accounts)}));
	}
}

function digestText(newBanks: NewBank[], missedBanks: MissedBank[]): string {
	const lines = ['Bank coverage since the last digest.'];
	if (newBanks.length > 0)
		lines.push(
			'',
			'Asked for or mapped, not listed before:',
			...newBanks.map(
				(bank) =>
					`- ${bank.label}${bank.countries.length > 0 ? ` (${bank.countries.join(', ')})` : ''}: ` +
					`${accounts(bank.accounts)}, ${bank.hasLayout ? 'a saved layout to build from' : 'no saved layout yet'}`,
			),
		);
	if (missedBanks.length > 0)
		lines.push(
			'',
			'Verified banks whose files their own readers did not read:',
			...missedBanks.map(
				(bank) =>
					`- ${LISTED_BANKS.get(bank.bankId)?.name ?? bank.bankId} (${bank.bankId}): ` +
					`${bank.misses} ${bank.misses === 1 ? 'miss' : 'misses'} from ${accounts(bank.accounts)}`,
			),
		);
	return lines.join('\n');
}

function accounts(count: number): string {
	return `${count} ${count === 1 ? 'account' : 'accounts'}`;
}
