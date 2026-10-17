import {Injectable, NotFoundException} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BANKING_RECURRING_SERIES_NOT_FOUND} from '../api/constants/banking-messages.constants';
import type {
	RecurringSeriesDto,
	RecurringSeriesListResponseDto,
	RecurringSeriesQueryDto,
} from '../api/dtos/recurring-series.dto';
import {BankTransaction} from '../bank-transaction.entity';
import type {BankTransactionCategory} from '../categorization/bank-transaction-category';
import {SQL_INTERNAL} from '../services/bank-transaction-filters';
import {formatCents} from '../summary/bank-transaction-summary';
import {RecurringSeriesDecision, type RecurringSeriesDecisionValue} from './recurring-series-decision.entity';
import {
	type DetectedRecurringSeries,
	type RecurringCandidate,
	detectRecurringSeries,
} from './recurring-series-detection';

const REFUND = 'REFUND' satisfies BankTransactionCategory;
const DECISION_ORDER: Record<RecurringSeriesDecisionValue | 'NONE', number> = {CONFIRMED: 0, NONE: 1, DISMISSED: 2};

type CandidateRow = {
	id: string;
	date: string;
	merchantKey: string;
	currency: string;
	amountCents: string;
	baseAmountCents: string | null;
	name: string;
};

/** Detects recurring payments on read from the owner's booked history; only the owner's decisions are stored. */
@Injectable()
export class RecurringSeriesService {
	constructor(
		@InjectRepository(BankTransaction)
		private readonly bankTransactionRepository: Repository<BankTransaction>,
		@InjectRepository(RecurringSeriesDecision)
		private readonly decisionRepository: Repository<RecurringSeriesDecision>,
	) {}

	async list(
		{id: accountId, baseCurrency}: Pick<Account, 'id' | 'baseCurrency'>,
		{direction, asOf}: RecurringSeriesQueryDto,
	): Promise<RecurringSeriesListResponseDto> {
		const [detected, decisions] = await Promise.all([
			this.detect(accountId, asOf),
			this.decisionRepository.find({where: {accountId}}),
		]);
		const decisionBySeries = resolveDecisions(detected, decisions);
		const series = detected
			.filter((entry) => entry.direction === direction)
			.map((entry) => ({entry, decision: decisionBySeries.get(entry.key)?.decision ?? null}))
			.sort(
				(a, b) =>
					DECISION_ORDER[a.decision ?? 'NONE'] - DECISION_ORDER[b.decision ?? 'NONE'] ||
					Number(a.entry.status === 'ENDED') - Number(b.entry.status === 'ENDED') ||
					compareDescending(a.entry.monthlyEquivalent, b.entry.monthlyEquivalent) ||
					a.entry.name.localeCompare(b.entry.name) ||
					a.entry.key.localeCompare(b.entry.key),
			);

		const activeConfirmed = series.filter(
			({entry, decision}) => decision === 'CONFIRMED' && entry.status === 'ACTIVE',
		);
		const confirmedMonthlyTotal = activeConfirmed.reduce(
			(sum, {entry}) => sum + (entry.monthlyEquivalent ?? 0n),
			0n,
		);

		return {
			series: series.map(({entry, decision}) => toResponse(entry, decision)),
			confirmedMonthlyTotal: formatCents(confirmedMonthlyTotal),
			unconvertedConfirmedCount: activeConfirmed.filter(({entry}) => entry.monthlyEquivalent === null).length,
			baseCurrency,
		};
	}

	/**
	 * Decides only series detected right now, so an unknown or another owner's key is not found.
	 * `null` returns the series to suggested.
	 */
	async updateDecision(accountId: Account['id'], seriesKey: string, decision: RecurringSeriesDecisionValue | null) {
		const detected = await this.detect(accountId, today());
		const series = detected.find((entry) => entry.key === seriesKey);
		if (!series) throw new NotFoundException(BANKING_RECURRING_SERIES_NOT_FOUND);
		const decisions = await this.decisionRepository.find({where: {accountId}});
		// Replace only the decision this series shows, including one inherited from its earlier key.
		const shown = resolveDecisions(detected, decisions).get(seriesKey);
		const superseded = decisions.filter((entry) => entry.seriesKey === seriesKey || entry.id === shown?.id);
		await this.decisionRepository.manager.transaction(async (manager) => {
			if (superseded.length > 0) {
				await manager.delete(
					RecurringSeriesDecision,
					superseded.map(({id}) => id),
				);
			}
			if (decision !== null) {
				await manager.insert(RecurringSeriesDecision, {
					accountId,
					seriesKey,
					decision,
					transactionIds: series.transactionIds,
				});
			}
		});
	}

	/** The ids of a series' payments, for the transactions list's drill-through filter. */
	async findTransactionIds(accountId: Account['id'], seriesKey: string): Promise<string[]> {
		return (await this.findDetected(accountId, seriesKey)).transactionIds;
	}

	private async findDetected(accountId: Account['id'], seriesKey: string): Promise<DetectedRecurringSeries> {
		// Keys and payments don't depend on the date; only status and flags do.
		const today = new Date().toISOString().slice(0, 10);
		const series = (await this.detect(accountId, today)).find((entry) => entry.key === seriesKey);
		if (!series) throw new NotFoundException(BANKING_RECURRING_SERIES_NOT_FOUND);
		return series;
	}

	private async detect(accountId: Account['id'], today: string): Promise<DetectedRecurringSeries[]> {
		const rows = await this.bankTransactionRepository
			.createQueryBuilder('transaction')
			.innerJoin('transaction.bankAccount', 'bankAccount')
			.innerJoin('bankAccount.bankConnection', 'connection')
			.select('transaction.id', 'id')
			.addSelect('"transaction"."bookingDate"::text', 'date')
			.addSelect('transaction.merchantKey', 'merchantKey')
			.addSelect('transaction.currency', 'currency')
			.addSelect('ROUND(ABS("transaction"."amount") * 100)::text', 'amountCents')
			.addSelect('ROUND(ABS("transaction"."amountInBaseCurrency") * 100)::text', 'baseAmountCents')
			.addSelect('transaction.displayDescription', 'name')
			.where('connection.accountId = :accountId', {accountId})
			.andWhere('transaction.merchantKey IS NOT NULL')
			.andWhere('transaction.bookingDate IS NOT NULL')
			.andWhere("transaction.transactionStatus = 'BOOK'")
			.andWhere("transaction.creditDebitIndicator IN ('DBIT', 'CRDT')")
			.andWhere('transaction.category IS DISTINCT FROM :refund', {refund: REFUND})
			.andWhere(`NOT ${SQL_INTERNAL}`)
			.andWhere('transaction.amount <> 0')
			.getRawMany<CandidateRow>();

		const candidates: RecurringCandidate[] = rows.map((row) => ({
			id: row.id,
			date: row.date,
			merchantKey: row.merchantKey,
			currency: row.currency,
			amountCents: BigInt(row.amountCents),
			baseAmountCents: row.baseAmountCents === null ? null : BigInt(row.baseAmountCents),
			name: row.name,
		}));
		return detectRecurringSeries(candidates, today);
	}
}

function toResponse(entry: DetectedRecurringSeries, decision: RecurringSeriesDecisionValue | null): RecurringSeriesDto {
	return {
		key: entry.key,
		name: entry.name,
		direction: entry.direction,
		cadence: entry.cadence,
		amountKind: entry.amountKind,
		currency: entry.currency,
		typicalAmount: entry.typicalAmount,
		latestAmount: entry.latestAmount,
		monthlyEquivalent: entry.monthlyEquivalent === null ? null : formatCents(entry.monthlyEquivalent),
		transactionCount: entry.transactionIds.length,
		firstDate: entry.firstDate,
		lastDate: entry.lastDate,
		nextExpectedDate: entry.nextExpectedDate,
		status: entry.status,
		flags: entry.flags,
		decision,
	};
}

/**
 * Which decision each current series shows. A decision applies to its own key; once that key is gone
 * (the series was reclassified or split), it passes to exactly one series: the one sharing most of its
 * payments. Every decision applies at most once, so changing one series never changes another.
 */
function resolveDecisions(
	detected: readonly DetectedRecurringSeries[],
	decisions: readonly RecurringSeriesDecision[],
): Map<string, RecurringSeriesDecision> {
	const result = new Map<string, RecurringSeriesDecision>();
	const keys = new Set(detected.map(({key}) => key));
	for (const decision of decisions) {
		if (keys.has(decision.seriesKey)) result.set(decision.seriesKey, decision);
	}
	const shares = new Map<string, number>();
	for (const decision of decisions) {
		if (keys.has(decision.seriesKey)) continue;
		const decided = new Set(decision.transactionIds);
		let best: DetectedRecurringSeries | undefined;
		let bestShared = 0;
		for (const series of detected) {
			const shared = series.transactionIds.filter((id) => decided.has(id)).length;
			if (shared > bestShared || (shared === bestShared && shared > 0 && best && series.key < best.key)) {
				best = series;
				bestShared = shared;
			}
		}
		if (!best || (result.has(best.key) && (shares.get(best.key) ?? Infinity) >= bestShared)) continue;
		result.set(best.key, decision);
		shares.set(best.key, bestShared);
	}
	return result;
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function compareDescending(a: bigint | null, b: bigint | null): number {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return a > b ? -1 : 1;
}
