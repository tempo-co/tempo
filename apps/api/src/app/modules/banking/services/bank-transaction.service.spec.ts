import type {BankTransaction as BankTransactionResponse} from '@tempo/contracts';
import {ObjectLiteral, Repository, SelectQueryBuilder} from 'typeorm';

import {BankConnection} from '../bank-connection.entity';
import {
	BANK_TRANSACTION_CASH_FLOW_TREATMENTS,
	BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
	BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES,
	BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
} from '../bank-transaction-financial-event';
import {BankTransaction} from '../bank-transaction.entity';
import {BankTransactionCategorizationService} from '../categorization/bank-transaction-categorization.service';
import {MerchantLogoService} from '../merchant-logos/merchant-logo.service';
import {RecurringSeriesService} from '../recurring/recurring-series.service';
import {BankTransactionService} from './bank-transaction.service';
import {OwnTransferService} from './own-transfer.service';

function createTransaction(): BankTransaction {
	return {
		id: 'transaction-id',
		description: 'SEPA Overboeking IBAN: GB00TEST BIC: TESTGB21 Naam: Example Payee Kenmerk: NOTPROVIDED',
		displayDescription: 'Example Payee',
		counterpartyName: null,
		financialEventType: null,
		financialEventSource: null,
		financialEventRuleVersion: null,
		bankAccount: {
			name: 'Example account',
			alias: null,
			bankConnection: {
				aspspName: 'Example Bank',
				aspspCountry: 'NL',
			},
		},
	} as unknown as BankTransaction;
}

function createQueryBuilder<T extends ObjectLiteral>(): SelectQueryBuilder<T> & {
	getOne: jest.Mock;
	getManyAndCount: jest.Mock;
} {
	const queryBuilder = {
		innerJoinAndSelect: jest.fn().mockReturnThis(),
		innerJoin: jest.fn().mockReturnThis(),
		leftJoinAndSelect: jest.fn().mockReturnThis(),
		where: jest.fn().mockReturnThis(),
		andWhere: jest.fn().mockReturnThis(),
		orderBy: jest.fn().mockReturnThis(),
		addOrderBy: jest.fn().mockReturnThis(),
		offset: jest.fn().mockReturnThis(),
		limit: jest.fn().mockReturnThis(),
		getOne: jest.fn(),
		getManyAndCount: jest.fn(),
	};
	return queryBuilder as unknown as SelectQueryBuilder<T> & {
		getOne: jest.Mock;
		getManyAndCount: jest.Mock;
	};
}

function createService(
	repository: unknown,
	connectionRepository: Repository<BankConnection> = {} as Repository<BankConnection>,
): BankTransactionService {
	return new BankTransactionService(
		connectionRepository,
		repository as Repository<BankTransaction>,
		{} as OwnTransferService,
		{} as BankTransactionCategorizationService,
		{} as RecurringSeriesService,
		{getLogoUrls: async () => new Map()} as unknown as MerchantLogoService,
	);
}

describe('BankTransactionService display descriptions', () => {
	it('includes a concise display description in detailed responses while preserving raw text', async () => {
		const transaction = createTransaction();
		const queryBuilder = createQueryBuilder<BankTransaction>();
		queryBuilder.getOne.mockResolvedValue(transaction);
		const repository = {createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)};
		const service = createService(repository);

		const response = await service.findById('account-id', transaction.id);

		expect(response).toMatchObject<Partial<BankTransactionResponse>>({
			description: transaction.description,
			displayDescription: 'Example Payee',
		});
	});

	it('includes a concise display description in connection transaction summaries', async () => {
		const transaction = createTransaction();
		const queryBuilder = createQueryBuilder<BankTransaction>();
		queryBuilder.getManyAndCount.mockResolvedValue([[transaction], 1]);
		const repository = {createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)};
		const service = createService(repository, {
			findOne: jest.fn().mockResolvedValue({id: 'connection-id'}),
		} as unknown as Repository<BankConnection>);

		const response = await service.findAllByConnectionId('account-id', 'connection-id', 10);

		expect(response.transactions[0]).toMatchObject({
			description: transaction.description,
			displayDescription: 'Example Payee',
		});
	});

	it('exposes currency exchange metadata and internal treatment in detailed responses', async () => {
		const transaction = {
			...createTransaction(),
			creditDebitIndicator: 'DBIT',
			category: 'SHOPPING',
			categoryStatus: 'COMPLETED',
			categorySource: 'MANUAL',
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			financialEventSource: BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES.RULE,
			financialEventRuleVersion: BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
		};
		const queryBuilder = createQueryBuilder<BankTransaction>();
		queryBuilder.getOne.mockResolvedValue(transaction);
		const repository = {createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)};
		const service = createService(repository);

		const response = await service.findById('account-id', transaction.id);

		expect(response).toMatchObject({
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			financialEventSource: BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES.RULE,
			financialEventRuleVersion: BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
			cashFlowTreatment: BANK_TRANSACTION_CASH_FLOW_TREATMENTS.INTERNAL,
			category: 'SHOPPING',
			categorySource: 'MANUAL',
		});
	});

	it('exposes currency exchange metadata and internal treatment in connection summaries', async () => {
		const transaction = {
			...createTransaction(),
			creditDebitIndicator: 'CRDT',
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			financialEventSource: BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES.RULE,
			financialEventRuleVersion: BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
		};
		const queryBuilder = createQueryBuilder<BankTransaction>();
		queryBuilder.getManyAndCount.mockResolvedValue([[transaction], 1]);
		const repository = {createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)};
		const service = createService(repository, {
			findOne: jest.fn().mockResolvedValue({id: 'connection-id'}),
		} as unknown as Repository<BankConnection>);

		const response = await service.findAllByConnectionId('account-id', 'connection-id', 10);

		expect(response.transactions[0]).toMatchObject({
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			financialEventSource: BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES.RULE,
			financialEventRuleVersion: BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
			cashFlowTreatment: BANK_TRANSACTION_CASH_FLOW_TREATMENTS.INTERNAL,
		});
	});
});
