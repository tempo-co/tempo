import {ConfigurationService} from '@core/config/config.service';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {BankTransactionCategorizationProviderError} from '@modules/banking/categorization/bank-transaction-categorization.provider';
import {
	BankTransactionCategorizationInput,
	BankTransactionCategorizationResult,
} from '@modules/banking/categorization/bank-transaction-categorization.types';
import {CategorizationContextLoader} from '@modules/banking/categorization/categorization-context-loader.service';
import {CategorizationPipeline} from '@modules/banking/categorization/categorization-pipeline.service';
import {CategorizationRowStore} from '@modules/banking/categorization/categorization-row-store.service';
import {CategorizationScheduler} from '@modules/banking/categorization/categorization-scheduler.service';
import {ManualCategoryService} from '@modules/banking/categorization/manual-category.service';

/** A provider result as a test double writes it; the route and model default to the API's. */
export type ProviderResult = Omit<BankTransactionCategorizationResult, 'provider' | 'model'> &
	Partial<Pick<BankTransactionCategorizationResult, 'provider' | 'model'>>;

export function withRoute(result: ProviderResult): BankTransactionCategorizationResult {
	return {provider: 'claude-api', model: 'test-model', ...result};
}

/** The result of a claim update that took these rows. */
export function claimedRows(...ids: string[]) {
	return {affected: ids.length, raw: ids.map((id) => ({id}))};
}

/**
 * A query builder double shared by every query. `results` answer the next `execute` calls in order; after that, an
 * update succeeds, and a claim takes every row it asked for.
 */
export function createUpdateQueryBuilder(
	results: readonly {affected: number; raw?: readonly {id: string}[]}[] = [],
	rawRows: readonly {id: string}[] = [],
) {
	let requestedIds: string[] = [];
	const builder = {
		update: jest.fn().mockReturnThis(),
		select: jest.fn().mockReturnThis(),
		addSelect: jest.fn().mockReturnThis(),
		distinct: jest.fn().mockReturnThis(),
		innerJoin: jest.fn().mockReturnThis(),
		groupBy: jest.fn().mockReturnThis(),
		addGroupBy: jest.fn().mockReturnThis(),
		limit: jest.fn().mockReturnThis(),
		set: jest.fn().mockReturnThis(),
		where: jest.fn(),
		andWhere: jest.fn(),
		orderBy: jest.fn().mockReturnThis(),
		addOrderBy: jest.fn().mockReturnThis(),
		take: jest.fn().mockReturnThis(),
		returning: jest.fn().mockReturnThis(),
		execute: jest.fn(async () => ({
			affected: Math.max(requestedIds.length, 1),
			raw: requestedIds.map((id) => ({id})),
		})),
		getRawMany: jest.fn().mockResolvedValue(rawRows),
	};
	for (const condition of [builder.where, builder.andWhere])
		condition.mockImplementation((_sql: string, parameters?: {claimedIds?: string[]}) => {
			if (parameters?.claimedIds) requestedIds = parameters.claimedIds;
			return builder;
		});
	for (const result of results) builder.execute.mockResolvedValueOnce(result as never);
	return builder;
}

/** The categorization services over one repository, queue, provider and configuration double. */
export function createCategorizationServices({
	enabled = true,
	webSearchEnabled = false,
	rows = [],
	providerResult = [],
	providerError,
	queryBuilder,
	nodeEnv = 'test',
}: {
	nodeEnv?: string;
	enabled?: boolean;
	webSearchEnabled?: boolean;
	rows?: BankTransaction[];
	providerResult?: readonly ProviderResult[];
	providerError?: BankTransactionCategorizationProviderError;
	queryBuilder?: ReturnType<typeof createUpdateQueryBuilder>;
} = {}) {
	const queue = {
		addBulk: jest.fn().mockResolvedValue([]),
		add: jest.fn().mockResolvedValue({}),
		upsertJobScheduler: jest.fn().mockResolvedValue({}),
		removeJobScheduler: jest.fn().mockResolvedValue(true),
	};
	// Answers each call with the given results for its rows, or OTHER for rows without one.
	const provider = {
		categorize: jest.fn().mockImplementation(async (inputs: readonly BankTransactionCategorizationInput[]) => {
			if (providerError) throw providerError;
			return inputs
				.map(
					({correlationId}) =>
						providerResult.find((result) => result.correlationId === correlationId) ?? {
							correlationId,
							category: 'OTHER' as const,
							confidence: 0.5,
						},
				)
				.map(withRoute);
		}),
	};
	const config = {
		get: jest.fn((key: string) => {
			if (key === 'AI_CATEGORIZATION_ENABLED') return enabled;
			if (key === 'AI_CATEGORIZATION_WEB_SEARCH_ENABLED') return webSearchEnabled;
			if (key === 'AI_CATEGORIZATION_MODEL') return 'configured-model';
			if (key === 'NODE_ENV') return nodeEnv;
			throw new Error(`Unexpected config key: ${key}`);
		}),
	} as unknown as ConfigurationService;
	const repository = {
		find: jest.fn().mockResolvedValue(rows),
		update: jest.fn().mockResolvedValue({affected: 1}),
		createQueryBuilder: jest.fn().mockReturnValue(queryBuilder ?? createUpdateQueryBuilder()),
	};
	const scheduler = new CategorizationScheduler(repository as never, queue as never, config);
	const rowStore = new CategorizationRowStore(repository as never);
	const contextLoader = new CategorizationContextLoader(repository as never);
	const pipeline = new CategorizationPipeline(rowStore, contextLoader, scheduler, provider as never, config);
	const manualCategories = new ManualCategoryService(repository as never, contextLoader, scheduler);
	return {scheduler, pipeline, manualCategories, queue, provider, repository, config};
}
