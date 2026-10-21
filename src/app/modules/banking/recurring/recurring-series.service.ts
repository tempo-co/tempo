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
import {findContinuationPairs, joinContinuation} from './recurring-continuation';
import {
	RecurringContinuationChoice,
	type RecurringContinuationChoiceValue,
} from './recurring-continuation-choice.entity';
import {type RecurringEvidence, inferRecurringIdentities} from './recurring-payee-identity';
import {RecurringSeriesDecision, type RecurringSeriesDecisionValue} from './recurring-series-decision.entity';
import {
	type DetectedRecurringSeries,
	type RecurringCandidate,
	detectRecurringSeries,
} from './recurring-series-detection';
import {isOrdinaryRetailExpense} from './recurring-series-eligibility';

const REFUND = 'REFUND' satisfies BankTransactionCategory;
const DECISION_ORDER: Record<RecurringSeriesDecisionValue | 'NONE', number> = {CONFIRMED: 0, NONE: 1, DISMISSED: 2};

/** How a series relates to an earlier history it may continue, and the saved answers behind it. */
type Continuation = {
	choice: RecurringContinuationChoiceValue | null;
	previous: DetectedRecurringSeries;
	/** The newer history of the pair, when it is shown separately. */
	newer: DetectedRecurringSeries;
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

/** Detects recurring payments on read; stores only the owner's decisions and same-payment answers. */
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
			.map((entry) => ({entry, decision: shownDecision(entry, decisionBySeries.get(entry.key) ?? [])}))
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
			series: series.map(({entry, decision}) =>
				toResponse(entry, decision, continuationBySeries.get(entry.key) ?? null),
			),
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
		const {detected, decisionBySeries} = await this.readState(accountId, today());
		const series = detected.find((entry) => entry.key === seriesKey);
		if (!series) throw new NotFoundException(BANKING_RECURRING_SERIES_NOT_FOUND);
		// Replace every decision owned by this current series, including hidden decisions from merged parts.
		const superseded = decisionBySeries.get(seriesKey) ?? [];
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

	/**
	 * Answers whether a series continues the earlier history it is shown with. `LINKED` and `SEPARATE` answer an open
	 * question; `null` removes the answer, splitting a linked history or asking again.
	 */
	async updateContinuation(
		accountId: Account['id'],
		seriesKey: string,
		choice: RecurringContinuationChoiceValue | null,
	) {
		const {continuationBySeries, choiceIds} = await this.readState(accountId, today());
		const continuation = continuationBySeries.get(seriesKey);
		if (!continuation || (choice === null) === (continuation.choice === null)) {
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
			if (choice !== null) {
				await manager.insert(RecurringContinuationChoice, {
					accountId,
					choice,
					olderTransactionIds: continuation.previous.transactionIds,
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
		const {detected, linked} = applyLinkedChoices(
			detectRecurringSeries(candidates, today),
			choices,
			candidatesById,
			today,
		);
		const decisionBySeries = resolveDecisions(detected, decisions);
		const continuationBySeries = new Map(linked);
		for (const {older, newer} of findContinuationPairs(detected, candidatesById, today)) {
			// A linked history keeps its answer, so it can be undone, until the owner unlinks it.
			if (continuationBySeries.has(newer.key)) continue;
			// A dismissed history is not offered again as part of another one.
			if (
				[older, newer].some(
					(entry) => shownDecision(entry, decisionBySeries.get(entry.key) ?? []) === 'DISMISSED',
				)
			)
				continue;
			const saved = choices.filter((choice) => choice.choice === 'SEPARATE' && answers(choice, older, newer));
			continuationBySeries.set(newer.key, {
				choice: saved.length ? 'SEPARATE' : null,
				previous: older,
				newer,
				saved,
			});
		}
		return {
			detected: detected.filter(
				(entry) => decisionBySeries.has(entry.key) || !isOrdinaryRetailExpense(entry, candidatesById),
			),
			decisionBySeries,
			continuationBySeries,
			choiceIds: new Set(choices.map(({id}) => id)),
		};
	}
}

/**
 * A dismissal covers the payments it was made on. When payments restart after the series had stopped, it is suggested
 * again; a confirmation carries over, because the owner already said the series is real.
 */
function shownDecision(
	entry: DetectedRecurringSeries,
	decisions: readonly RecurringSeriesDecision[],
): RecurringSeriesDecisionValue | null {
	const decision = decisions[0]?.decision;
	// Regrouping must not silently choose one side of conflicting owner decisions.
	if (!decision || decisions.some((saved) => saved.decision !== decision)) return null;
	if (decision !== 'DISMISSED') return decision;
	// Only a restart after the last payment the owner dismissed brings the series back. Ids are in date order.
	const decided = new Set(decisions.flatMap(({transactionIds}) => transactionIds));
	const lastDecided = entry.transactionIds.findLastIndex((id) => decided.has(id));
	const later = new Set(entry.transactionIds.slice(lastDecided + 1));
	return entry.restartTransactionIds.some((id) => later.has(id)) ? null : decision;
}

/** Joins the histories the owner linked, oldest answer first, while their union still reads as one history. */
function applyLinkedChoices(
	series: DetectedRecurringSeries[],
	choices: readonly RecurringContinuationChoice[],
	candidatesById: ReadonlyMap<string, RecurringCandidate>,
	today: string,
): {detected: DetectedRecurringSeries[]; linked: Map<string, Continuation>} {
	let detected = series;
	const linked = new Map<string, Continuation>();
	for (const choice of choices) {
		if (choice.choice !== 'LINKED') continue;
		const older = detected.find(({transactionIds}) =>
			transactionIds.some((id) => choice.olderTransactionIds.includes(id)),
		);
		const newer = detected.find(({transactionIds}) =>
			transactionIds.some((id) => choice.newerTransactionIds.includes(id)),
		);
		if (!older || !newer || older === newer || older.lastDate >= newer.firstDate) continue;
		const joined = joinContinuation(older, newer, candidatesById, today);
		if (!joined) continue;
		detected = [...detected.filter((entry) => entry !== older && entry !== newer), joined];
		linked.delete(older.key);
		linked.delete(newer.key);
		linked.set(joined.key, {choice: 'LINKED', previous: older, newer, saved: [choice]});
	}
	return {detected, linked};
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
	decision: RecurringSeriesDecisionValue | null,
	continuation: Continuation | null,
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
		decision,
		continuation: continuation && toContinuationResponse(continuation),
	};
}

function toContinuationResponse({choice, previous}: Continuation): RecurringContinuationDto {
	return {
		choice,
		previousName: previous.name,
		previousFirstDate: previous.firstDate,
		previousLastDate: previous.lastDate,
	};
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
