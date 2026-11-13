import {BankConnectionQueryService} from './bank-connection-query.service';

const BANK_CONNECTION_QUERY_SERVICE_DEPENDENCIES = [
	'bankConnectionRepository',
	'bankAccountRepository',
	'bankAccountBalanceRepository',
	'dataSource',
] as const;

/** An owner whose base currency is not chosen yet, so balances are not converted. */
const OWNER = {id: 'owner-account-id', baseCurrency: null};

const DEFAULT_DEPENDENCIES: Partial<Record<string, unknown>> = {};

/** Builds the service with named test doubles; unspecified dependencies are empty objects. */
function createBankConnectionQueryService(
	dependencies: Partial<Record<(typeof BANK_CONNECTION_QUERY_SERVICE_DEPENDENCIES)[number], unknown>> = {},
): BankConnectionQueryService {
	return new BankConnectionQueryService(
		...(BANK_CONNECTION_QUERY_SERVICE_DEPENDENCIES.map(
			(name) => dependencies[name] ?? DEFAULT_DEPENDENCIES[name] ?? {},
		) as ConstructorParameters<typeof BankConnectionQueryService>),
	);
}

describe('BankConnectionQueryService findAll', () => {
	/** Chainable query builder double that records calls and resolves `getMany` with the given rows. */
	function createQueryBuilderMock(rows: unknown[]) {
		const queryBuilder = {
			innerJoin: jest.fn().mockReturnThis(),
			addSelect: jest.fn().mockReturnThis(),
			distinctOn: jest.fn().mockReturnThis(),
			where: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			orderBy: jest.fn().mockReturnThis(),
			addOrderBy: jest.fn().mockReturnThis(),
			getMany: jest.fn().mockResolvedValue(rows),
		};
		return queryBuilder;
	}

	/** Data source double whose sync-run query builder resolves `getRawMany` with the given rows. */
	function createRunHistoryMock(rows: unknown[]) {
		const queryBuilder = {
			innerJoin: jest.fn().mockReturnThis(),
			select: jest.fn().mockReturnThis(),
			addSelect: jest.fn().mockReturnThis(),
			where: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			groupBy: jest.fn().mockReturnThis(),
			getRawMany: jest.fn().mockResolvedValue(rows),
		};
		return {queryBuilder, dataSource: {getRepository: jest.fn(() => ({createQueryBuilder: () => queryBuilder}))}};
	}

	const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

	function createBalance(id: string, bankAccountId: string, balanceType: string, amount: string) {
		return {
			id,
			bankAccountId,
			name: null,
			balanceType,
			amount,
			currency: 'EUR',
			lastChangeDateTime: null,
			referenceDate: null,
			observedAt: new Date('2026-01-02T00:00:00.000Z'),
		};
	}

	it('loads accounts and latest balances for every connection in one query each', async () => {
		const connections = [
			{
				id: 'connection-new',
				provider: 'enable-banking',
				aspspName: 'New Bank',
				aspspCountry: 'NL',
				createdAt: CREATED_AT,
			},
			{
				id: 'connection-old',
				provider: 'enable-banking',
				aspspName: 'Old Bank',
				aspspCountry: 'DE',
				createdAt: CREATED_AT,
			},
			{
				id: 'connection-empty',
				provider: 'enable-banking',
				aspspName: 'Empty Bank',
				aspspCountry: 'FR',
				createdAt: CREATED_AT,
			},
		];
		const bankAccounts = [
			{id: 'account-old-1', name: 'Old 1', bankConnection: {id: 'connection-old'}},
			{id: 'account-new-1', name: 'New 1', bankConnection: {id: 'connection-new'}},
			{id: 'account-old-2', name: 'Old 2', bankConnection: {id: 'connection-old'}},
		];
		const balances = [
			createBalance('balance-1', 'account-new-1', 'BOOKED', '10.00000000'),
			createBalance('balance-2', 'account-old-1', 'AVAILABLE', '20.00000000'),
			createBalance('balance-3', 'account-old-1', 'BOOKED', '21.00000000'),
		];
		const connectionQueryBuilder = createQueryBuilderMock(connections);
		const accountQueryBuilder = createQueryBuilderMock(bankAccounts);
		const balanceQueryBuilder = createQueryBuilderMock(balances);
		const bankConnectionRepository = {createQueryBuilder: jest.fn(() => connectionQueryBuilder)};
		const bankAccountRepository = {createQueryBuilder: jest.fn(() => accountQueryBuilder)};
		const bankAccountBalanceRepository = {createQueryBuilder: jest.fn(() => balanceQueryBuilder)};
		const runHistory = createRunHistoryMock([
			{connectionId: 'connection-old', lastSuccessfulSyncAt: new Date('2026-01-03T00:00:00.000Z')},
		]);
		const service = createBankConnectionQueryService({
			bankConnectionRepository,
			bankAccountRepository,
			bankAccountBalanceRepository,
			dataSource: runHistory.dataSource,
		});

		const result = await service.findAll(OWNER);

		expect(bankAccountRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
		expect(bankAccountBalanceRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
		expect(accountQueryBuilder.where).toHaveBeenCalledWith('bankConnection.id IN (:...connectionIds)', {
			connectionIds: ['connection-new', 'connection-old', 'connection-empty'],
		});
		expect(accountQueryBuilder.andWhere).toHaveBeenCalledWith('bankConnection.accountId = :accountId', {
			accountId: OWNER.id,
		});
		expect(accountQueryBuilder.orderBy).toHaveBeenCalledWith('bankAccount.createdAt', 'ASC');
		expect(balanceQueryBuilder.distinctOn).toHaveBeenCalledWith(['balance.bankAccountId', 'balance.balanceType']);
		expect(balanceQueryBuilder.where).toHaveBeenCalledWith('balance.bankAccountId IN (:...bankAccountIds)', {
			bankAccountIds: ['account-old-1', 'account-new-1', 'account-old-2'],
		});
		expect(balanceQueryBuilder.andWhere).toHaveBeenCalledWith('bankConnection.accountId = :accountId', {
			accountId: OWNER.id,
		});
		expect(balanceQueryBuilder.orderBy).toHaveBeenCalledWith('balance.bankAccountId', 'ASC');
		expect(balanceQueryBuilder.addOrderBy.mock.calls).toEqual([
			['balance.balanceType', 'ASC'],
			['balance.observedAt', 'DESC'],
			['balance.id', 'DESC'],
		]);

		expect(runHistory.dataSource.getRepository).toHaveBeenCalledTimes(1);
		expect(runHistory.queryBuilder.where).toHaveBeenCalledWith('run.bankConnectionId IN (:...connectionIds)', {
			connectionIds: ['connection-new', 'connection-old', 'connection-empty'],
		});
		expect(runHistory.queryBuilder.andWhere).toHaveBeenCalledWith('bankConnection.accountId = :accountId', {
			accountId: OWNER.id,
		});

		expect(result.map(({id}) => id)).toEqual(['connection-new', 'connection-old', 'connection-empty']);
		expect(result.map(({lastSuccessfulSyncAt}) => lastSuccessfulSyncAt)).toEqual([
			null,
			'2026-01-03T00:00:00.000Z',
			null,
		]);
		expect(result[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
		expect(result.map(({bankAccounts: accounts}) => accounts.map(({id}) => id))).toEqual([
			['account-new-1'],
			['account-old-1', 'account-old-2'],
			[],
		]);
		expect(result[0].bankAccounts[0].latestBalances).toEqual([
			expect.objectContaining({balanceType: 'BOOKED', amount: '10.00000000', isPrimary: true}),
		]);
		expect(result[1].bankAccounts[0].latestBalances).toEqual([
			expect.objectContaining({balanceType: 'AVAILABLE', amount: '20.00000000', isPrimary: true}),
			expect.objectContaining({balanceType: 'BOOKED', amount: '21.00000000', isPrimary: false}),
		]);
		expect(result[1].bankAccounts[1].latestBalances).toEqual([]);
		expect(result[0].bankAccounts[0]).not.toHaveProperty('bankConnection');
	});

	it('skips account and balance queries when the account has no connections', async () => {
		const bankAccountRepository = {createQueryBuilder: jest.fn()};
		const bankAccountBalanceRepository = {createQueryBuilder: jest.fn()};
		const service = createBankConnectionQueryService({
			bankConnectionRepository: {createQueryBuilder: jest.fn(() => createQueryBuilderMock([]))},
			bankAccountRepository,
			bankAccountBalanceRepository,
		});

		await expect(service.findAll(OWNER)).resolves.toEqual([]);
		expect(bankAccountRepository.createQueryBuilder).not.toHaveBeenCalled();
		expect(bankAccountBalanceRepository.createQueryBuilder).not.toHaveBeenCalled();
	});

	it('skips the balance query when connections have no bank accounts', async () => {
		const bankAccountBalanceRepository = {createQueryBuilder: jest.fn()};
		const service = createBankConnectionQueryService({
			bankConnectionRepository: {
				createQueryBuilder: jest.fn(() =>
					createQueryBuilderMock([
						{id: 'connection-id', aspspName: 'Example Bank', aspspCountry: 'XX', createdAt: CREATED_AT},
					]),
				),
			},
			bankAccountRepository: {createQueryBuilder: jest.fn(() => createQueryBuilderMock([]))},
			bankAccountBalanceRepository,
			dataSource: createRunHistoryMock([]).dataSource,
		});

		const result = await service.findAll(OWNER);

		expect(result).toEqual([expect.objectContaining({id: 'connection-id', bankAccounts: []})]);
		expect(bankAccountBalanceRepository.createQueryBuilder).not.toHaveBeenCalled();
	});
});
