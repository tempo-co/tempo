import {ConflictException, Injectable, NotFoundException} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {
	BANKING_RECURRING_CONTINUATION_CHANGED,
	BANKING_RECURRING_SERIES_NOT_FOUND,
} from '../api/constants/banking-messages.constants';
import type {
	RecurringContinuationDto,
	RecurringSeriesDto,
	RecurringSeriesListResponseDto,
	RecurringSeriesQueryDto,
} from '../api/dtos/recurring-series.dto';
import {BankTransaction} from '../bank-transaction.entity';
import type {BankTransactionCategory} from '../categorization/bank-transaction-category';
import {SQL_INTERNAL} from '../services/bank-transaction-filters';
import {formatCents} from '../summary/bank-transaction-summary';
import {findContinuationPairs} from './recurring-continuation';
import {RecurringContinuationChoice} from './recurring-continuation-choice.entity';
import {type RecurringEvidence, inferRecurringIdentities} from './recurring-payee-identity';
import {RecurringSeriesDecision} from './recurring-series-decision.entity';
import {
	type DetectedRecurringSeries,
	type RecurringCandidate,
	detectRecurringSeries,
} from './recurring-series-detection';
import {isOrdinaryRetailExpense} from './recurring-series-eligibility';

const REFUND = 'REFUND' satisfies BankTransactionCategory;

/** Two successive histories of one obligation: joined automatically, or kept apart because the owner unlinked them. */
type Continuation = {
	linked: boolean;
	older: DetectedRecurringSeries;
	newer: DetectedRecurringSeries;
	/** The owner's unlink answers for this pair. */
	saved: RecurringContinuationChoice[];
};

type CandidateRow = {
	id: string;
	bankAccountId: string;
	date: string;
	merchantKey: string;
	currency: string;
	amountCents: string;
	baseAmountCents: string | null;
	name: string;
	category: string | null;
	description: string | null;
	counterpartyName: string | null;
	transactionType: string | null;
};

/** Detects recurring payments on read; stores only the owner's hidden series and unlinked histories. */
@Injectable()
export class RecurringSeriesService {
	constructor(
		@InjectRepository(BankTransaction)
		private readonly bankTransactionRepository: Repository<BankTransaction>,
		@InjectRepository(RecurringSeriesDecision)
		private readonly decisionRepository: Repository<RecurringSeriesDecision>,
		@InjectRepository(RecurringContinuationChoice)
		private readonly continuationRepository: Repository<RecurringContinuationChoice>,
	) {}

	async list(
		{id: accountId, baseCurrency}: Pick<Account, 'id' | 'baseCurrency'>,
		{direction, asOf}: RecurringSeriesQueryDto,
	): Promise<RecurringSeriesListResponseDto> {
		const {detected, decisionBySeries, continuationBySeries} = await this.readState(accountId, asOf);
		const series = detected
			.filter((entry) => entry.direction === direction)
			.map((entry) => ({entry, hidden: isHidden(entry, decisionBySeries.get(entry.key) ?? [])}))
			.sort(
				(a, b) =>
					Number(a.hidden) - Number(b.hidden) ||
					Number(a.entry.status === 'ENDED') - Number(b.entry.status === 'ENDED') ||
					compareDescending(a.entry.monthlyEquivalent, b.entry.monthlyEquivalent) ||
					a.entry.name.localeCompare(b.entry.name) ||
					a.entry.key.localeCompare(b.entry.key),
			);

		// Every detected series counts until the owner hides it.
		const counted = series.filter(({entry, hidden}) => !hidden && entry.status === 'ACTIVE');
		const monthlyTotal = counted.reduce((sum, {entry}) => sum + (entry.monthlyEquivalent ?? 0n), 0n);

		return {
			series: series.map(({entry, hidden}) =>
				toResponse(entry, hidden, shownContinuation(entry, continuationBySeries.get(entry.key))),
			),
			monthlyTotal: formatCents(monthlyTotal),
			unconvertedCount: counted.filter(({entry}) => entry.monthlyEquivalent === null).length,
			baseCurrency,
		};
	}

	/** Hides a series detected right now, or shows it again; an unknown or another owner's key is not found. */
	async updateHidden(accountId: Account['id'], seriesKey: string, hidden: boolean) {
		const {detected, decisionBySeries} = await this.readState(accountId, today());
		const series = detected.find((entry) => entry.key === seriesKey);
		if (!series) throw new NotFoundException(BANKING_RECURRING_SERIES_NOT_FOUND);
		// Replace every decision owned by this current series, including older ones from merged parts.
		const superseded = decisionBySeries.get(seriesKey) ?? [];
		await this.decisionRepository.manager.transaction(async (manager) => {
			if (superseded.length > 0) {
				await manager.delete(
					RecurringSeriesDecision,
					superseded.map(({id}) => id),
				);
			}
			if (hidden) {
				await manager.insert(RecurringSeriesDecision, {
					accountId,
					seriesKey,
					decision: 'DISMISSED',
					transactionIds: series.transactionIds,
				});
			}
		});
	}

	/**
	 * Unlinks an automatically joined history (`linked: false`), or joins it again (`linked: true`). The key may be the
	 * joined series or either history of the pair; the request must change the pair's state.
	 */
	async updateContinuation(accountId: Account['id'], seriesKey: string, linked: boolean) {
		const {continuationBySeries, choiceIds} = await this.readState(accountId, today());
		const continuation = continuationBySeries.get(seriesKey);
		if (!continuation || continuation.linked === linked) {
			throw new NotFoundException(BANKING_RECURRING_SERIES_NOT_FOUND);
		}
		await this.continuationRepository.manager.transaction(async (manager) => {
			// One owner's answers change one at a time, and only from the state this answer was given on.
			await manager.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
			const current = await manager.find(RecurringContinuationChoice, {select: {id: true}, where: {accountId}});
			if (current.length !== choiceIds.size || current.some(({id}) => !choiceIds.has(id))) {
				throw new ConflictException(BANKING_RECURRING_CONTINUATION_CHANGED);
			}
			if (continuation.saved.length > 0) {
				await manager.delete(
					RecurringContinuationChoice,
					continuation.saved.map(({id}) => id),
				);
			}
			if (!linked) {
				await manager.insert(RecurringContinuationChoice, {
					accountId,
					choice: 'SEPARATE',
					olderTransactionIds: continuation.older.transactionIds,
					newerTransactionIds: continuation.newer.transactionIds,
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
		const {detected} = await this.readState(accountId, today);
		const series = detected.find((entry) => entry.key === seriesKey);
		if (!series) throw new NotFoundException(BANKING_RECURRING_SERIES_NOT_FOUND);
		return series;
	}

	private async readState(
		accountId: Account['id'],
		today: string,
	): Promise<{
		detected: DetectedRecurringSeries[];
		decisionBySeries: Map<string, RecurringSeriesDecision[]>;
		continuationBySeries: Map<string, Continuation>;
		choiceIds: Set<string>;
	}> {
		const rowsQuery = this.bankTransactionRepository
			.createQueryBuilder('transaction')
			.innerJoin('transaction.bankAccount', 'bankAccount')
			.innerJoin('bankAccount.bankConnection', 'connection')
			.select('transaction.id', 'id')
			.addSelect('transaction.bankAccountId', 'bankAccountId')
			.addSelect('"transaction"."bookingDate"::text', 'date')
			.addSelect('transaction.merchantKey', 'merchantKey')
			.addSelect('transaction.currency', 'currency')
			.addSelect('ROUND(ABS("transaction"."amount") * 100)::text', 'amountCents')
			.addSelect('ROUND(ABS("transaction"."amountInBaseCurrency") * 100)::text', 'baseAmountCents')
			.addSelect('transaction.displayDescription', 'name')
			.addSelect('transaction.category', 'category')
			.addSelect('transaction.description', 'description')
			.addSelect('transaction.counterpartyName', 'counterpartyName')
			.addSelect('transaction.transactionType', 'transactionType')
			.where('connection.accountId = :accountId', {accountId})
			.andWhere('transaction.merchantKey IS NOT NULL')
			.andWhere('transaction.bookingDate IS NOT NULL')
			.andWhere("UPPER(transaction.transactionStatus) IS DISTINCT FROM 'PDNG'")
			.andWhere("transaction.creditDebitIndicator IN ('DBIT', 'CRDT')")
			.andWhere('transaction.category IS DISTINCT FROM :refund', {refund: REFUND})
			.andWhere(`NOT ${SQL_INTERNAL}`)
			.andWhere('transaction.amount <> 0')
			.getRawMany<CandidateRow>();
		const [rows, decisions, choices] = await Promise.all([
			rowsQuery,
			this.decisionRepository.find({where: {accountId}}),
			this.continuationRepository.find({where: {accountId}, order: {createdAt: 'ASC', id: 'ASC'}}),
		]);

		const evidence: RecurringEvidence[] = rows.map((row) => ({
			id: row.id,
			bankAccountId: row.bankAccountId,
			date: row.date,
			merchantKey: row.merchantKey,
			currency: row.currency,
			amountCents: BigInt(row.amountCents),
			baseAmountCents: row.baseAmountCents === null ? null : BigInt(row.baseAmountCents),
			name: row.name,
			category: row.category,
			description: row.description,
			counterpartyName: row.counterpartyName,
			transactionType: row.transactionType,
		}));
		const candidates = inferRecurringIdentities(evidence);
		const candidatesById = new Map(candidates.map((row) => [row.id, row]));
		const {detected, continuations} = linkContinuations(
			detectRecurringSeries(candidates, today),
			choices,
			candidatesById,
			today,
		);
		const decisionBySeries = resolveDecisions(detected, decisions);
		return {
			detected: detected.filter(
				(entry) => decisionBySeries.has(entry.key) || !isOrdinaryRetailExpense(entry, candidatesById),
			),
			decisionBySeries,
			continuationBySeries: continuations,
			choiceIds: new Set(choices.map(({id}) => id)),
		};
	}
}

/**
 * A hidden series stays hidden for the payments it was hidden on. When payments restart after the series had stopped,
 * it counts again. Older confirmations no longer matter; conflicting saved decisions leave the series shown.
 */
function isHidden(entry: DetectedRecurringSeries, decisions: readonly RecurringSeriesDecision[]): boolean {
	if (decisions.length === 0 || decisions.some(({decision}) => decision !== 'DISMISSED')) return false;
	// Only a restart after the last payment the owner hid brings the series back. Ids are in date order.
	const decided = new Set(decisions.flatMap(({transactionIds}) => transactionIds));
	const lastDecided = entry.transactionIds.findLastIndex((id) => decided.has(id));
	const later = new Set(entry.transactionIds.slice(lastDecided + 1));
	return !entry.restartTransactionIds.some((id) => later.has(id));
}

/**
 * Joins every history that continues an earlier one unless the owner unlinked the pair. Each pair is reachable from
 * the joined series and from both of its histories, so an unlink can be undone from either side. Hidden series are
 * resolved on the joined result, so hiding a joined series hides all of it.
 */
function linkContinuations(
	series: DetectedRecurringSeries[],
	choices: readonly RecurringContinuationChoice[],
	candidatesById: ReadonlyMap<string, RecurringCandidate>,
	today: string,
): {detected: DetectedRecurringSeries[]; continuations: Map<string, Continuation>} {
	let detected = series;
	const continuations = new Map<string, Continuation>();
	const separate = choices.filter(({choice}) => choice === 'SEPARATE');
	for (const {older, newer, joined} of findContinuationPairs(series, candidatesById, today)) {
		const saved = separate.filter((choice) => answers(choice, older, newer));
		const linked = saved.length === 0;
		if (linked) detected = [...detected.filter((entry) => entry !== older && entry !== newer), joined];
		for (const {key} of linked ? [older, newer, joined] : [older, newer]) {
			continuations.set(key, {linked, older, newer, saved});
		}
	}
	return {detected, continuations};
}

/** Whether a saved answer was given for this pair: each side still holds a payment it was answered on. */
function answers(
	choice: RecurringContinuationChoice,
	older: DetectedRecurringSeries,
	newer: DetectedRecurringSeries,
): boolean {
	return (
		older.transactionIds.some((id) => choice.olderTransactionIds.includes(id)) &&
		newer.transactionIds.some((id) => choice.newerTransactionIds.includes(id))
	);
}

function toResponse(
	entry: DetectedRecurringSeries,
	hidden: boolean,
	continuation: RecurringContinuationDto | null,
): RecurringSeriesDto {
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
		priceChange: entry.priceChange,
		hidden,
		continuation,
	};
}

/** A joined series shows the earlier history it includes. */
function shownContinuation(
	entry: DetectedRecurringSeries,
	continuation: Continuation | undefined,
): RecurringContinuationDto | null {
	if (!continuation?.linked || entry === continuation.older || entry === continuation.newer) return null;
	const {older} = continuation;
	return {previousName: older.name, previousFirstDate: older.firstDate, previousLastDate: older.lastDate};
}

/**
 * Assigns each matching saved decision to one current series: its own key, otherwise the most shared
 * payments (ties by series key). Updates replace the whole group without changing snapshots or decisions
 * assigned to siblings.
 */
function resolveDecisions(
	detected: readonly DetectedRecurringSeries[],
	decisions: readonly RecurringSeriesDecision[],
): Map<string, RecurringSeriesDecision[]> {
	const result = new Map<string, RecurringSeriesDecision[]>();
	for (const decision of decisions) {
		let best = detected.find(({key}) => key === decision.seriesKey);
		if (!best) {
			const decided = new Set(decision.transactionIds);
			let bestShared = 0;
			for (const series of detected) {
				const shared = series.transactionIds.filter((id) => decided.has(id)).length;
				if (shared > bestShared || (shared === bestShared && shared > 0 && best && series.key < best.key)) {
					best = series;
					bestShared = shared;
				}
			}
		}
		if (!best) continue;
		const assigned = result.get(best.key) ?? [];
		assigned.push(decision);
		result.set(best.key, assigned);
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
