import {Injectable, NotFoundException} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BANKING_CONNECTION_NOT_FOUND, BANKING_TRANSACTION_NOT_FOUND} from '../api/constants/banking-messages.constants';
import {BankConnectionTransactionsResponseDto} from '../api/dtos/bank-connection-response.dto';
import {BankTransactionCategoryImpactResponseDto} from '../api/dtos/bank-transaction-category-impact.dto';
import {
	BankTransactionQueryDto,
	BankTransactionSortField,
	BankTransactionSortOrder,
	DEFAULT_BANK_TRANSACTION_PAGE_INDEX,
	DEFAULT_BANK_TRANSACTION_PAGE_SIZE,
} from '../api/dtos/bank-transaction-query.dto';
import {
	BankTransactionCounterpartDto,
	BankTransactionOwnTransferDto,
	BankTransactionResponseDto,
	BankTransactionsResponseDto,
} from '../api/dtos/bank-transaction-response.dto';
import {BankConnection} from '../bank-connection.entity';
import {toBankTransactionDirection} from '../bank-transaction-direction';
import {getBankTransactionCashFlowTreatment} from '../bank-transaction-financial-event';
import {BANK_TRANSACTION_TYPES} from '../bank-transaction-type';
import {BankTransaction} from '../bank-transaction.entity';
import {BankTransactionCategorizationService} from '../categorization/bank-transaction-categorization.service';
import type {
	BankTransactionCategorizationSource,
	BankTransactionCategorizationStatus,
} from '../categorization/bank-transaction-categorization.types';
import type {BankTransactionCategory} from '../categorization/bank-transaction-category';
import type {OwnTransferOverride} from '../own-transfer/own-transfer-detection';
import {applyBankTransactionFilters} from './bank-transaction-filters';
import {OwnTransferService} from './own-transfer.service';

@Injectable()
export class BankTransactionService {
	constructor(
		@InjectRepository(BankConnection)
		private readonly bankConnectionRepository: Repository<BankConnection>,
		@InjectRepository(BankTransaction)
		private readonly bankTransactionRepository: Repository<BankTransaction>,
		private readonly ownTransferService: OwnTransferService,
		private readonly categorizationService: BankTransactionCategorizationService,
	) {}

	async findAll(
		accountId: Account['id'],
		queryParams: BankTransactionQueryDto,
	): Promise<BankTransactionsResponseDto> {
		const pageIndex = queryParams.pagination?.pageIndex ?? DEFAULT_BANK_TRANSACTION_PAGE_INDEX;
		const pageSize = queryParams.pagination?.pageSize ?? DEFAULT_BANK_TRANSACTION_PAGE_SIZE;
		const query = this.createOwnerScopedQuery(accountId);

		applyBankTransactionFilters(query, queryParams.filter);

		const sortField = queryParams.sort?.by ?? BankTransactionSortField.BOOKING_DATE;
		const sortOrder = queryParams.sort?.order ?? BankTransactionSortOrder.DESC;
		const sortColumn =
			sortField === BankTransactionSortField.AMOUNT
				? 'transaction.amountInBaseCurrency'
				: sortField === BankTransactionSortField.CATEGORY
					? 'transaction.category'
					: sortField === BankTransactionSortField.SOURCE
						? 'connection.aspspName'
						: 'transaction.bookingDate';
		query.orderBy(sortColumn, sortOrder, 'NULLS LAST');
		if (sortField !== BankTransactionSortField.BOOKING_DATE) {
			query.addOrderBy('transaction.bookingDate', 'DESC', 'NULLS LAST');
		}
		query
			.addOrderBy('transaction.valueDate', 'DESC', 'NULLS LAST')
			.addOrderBy('transaction.id', 'DESC')
			.skip(pageIndex * pageSize)
			.take(pageSize);

		const [transactions, total] = await query.getManyAndCount();
		return {
			transactions: transactions.map((transaction) => this.toResponse(transaction)),
			total,
		};
	}

	async findAllByConnectionId(
		accountId: Account['id'],
		connectionId: BankConnection['id'],
		limit: number,
	): Promise<BankConnectionTransactionsResponseDto> {
		await this.findOwnedConnection(accountId, connectionId);

		const query = this.bankTransactionRepository
			.createQueryBuilder('transaction')
			.innerJoin('transaction.bankAccount', 'bankAccount')
			.innerJoin('bankAccount.bankConnection', 'connection')
			.innerJoin('connection.account', 'account')
			.where('connection.id = :connectionId', {connectionId})
			.andWhere('account.id = :accountId', {accountId})
			.orderBy('transaction.bookingDate', 'DESC', 'NULLS LAST')
			.addOrderBy('transaction.valueDate', 'DESC', 'NULLS LAST')
			.addOrderBy('transaction.createdAt', 'DESC')
			.take(limit);

		const [transactions, total] = await query.getManyAndCount();
		return {
			transactions: transactions.map((transaction) => this.toSharedResponseFields(transaction)),
			total,
		};
	}

	async findById(accountId: Account['id'], id: BankTransaction['id']): Promise<BankTransactionResponseDto> {
		return this.toResponse(await this.findOwnedTransaction(accountId, id));
	}

	async getCategoryImpact(
		accountId: Account['id'],
		id: BankTransaction['id'],
		category: BankTransactionCategory,
	): Promise<BankTransactionCategoryImpactResponseDto> {
		const transaction = await this.findOwnedTransaction(accountId, id);
		const {followUp, transactions, total} = await this.categorizationService.previewManualCategory(
			accountId,
			transaction,
			category,
		);
		return {
			action: followUp?.action ?? null,
			category: followUp?.action === 'APPLY' ? followUp.category : null,
			transactions: transactions.map((row) => ({
				id: row.id,
				transactionDate: row.transactionDate,
				bookingDate: row.bookingDate,
				displayDescription: row.displayDescription,
				amount: row.amount,
				currency: row.currency,
				...toCategorizationFields(row),
			})),
			total,
		};
	}

	async updateCategory(
		accountId: Account['id'],
		id: BankTransaction['id'],
		category: BankTransactionCategory,
		applyToTransactionIds?: readonly string[],
	): Promise<BankTransactionResponseDto> {
		const transaction = await this.findOwnedTransaction(accountId, id);
		const saved = await this.categorizationService.setManualCategory(
			accountId,
			transaction,
			category,
			applyToTransactionIds,
		);
		if (!saved) throw new NotFoundException(BANKING_TRANSACTION_NOT_FOUND);
		return this.toResponse(transaction);
	}

	async updateOwnTransferOverride(
		accountId: Account['id'],
		id: BankTransaction['id'],
		override: OwnTransferOverride | null,
	): Promise<BankTransactionResponseDto> {
		const updated = await this.ownTransferService.updateOverride(accountId, id, override);
		if (!updated) throw new NotFoundException(BANKING_TRANSACTION_NOT_FOUND);
		return this.findById(accountId, id);
	}

	private async findOwnedConnection(accountId: Account['id'], connectionId: BankConnection['id']) {
		const connection = await this.bankConnectionRepository.findOne({
			where: {id: connectionId, account: {id: accountId}},
		});
		if (!connection) throw new NotFoundException(BANKING_CONNECTION_NOT_FOUND);
		return connection;
	}

	private async findOwnedTransaction(accountId: Account['id'], id: BankTransaction['id']) {
		const transaction = await this.createOwnerScopedQuery(accountId)
			.andWhere('transaction.id = :transactionId', {transactionId: id})
			.getOne();
		if (!transaction) throw new NotFoundException(BANKING_TRANSACTION_NOT_FOUND);
		return transaction;
	}

	private createOwnerScopedQuery(accountId: Account['id']) {
		return (
			this.bankTransactionRepository
				.createQueryBuilder('transaction')
				.innerJoinAndSelect('transaction.bankAccount', 'bankAccount')
				.innerJoinAndSelect('bankAccount.bankConnection', 'connection')
				.innerJoin('connection.account', 'account')
				// Recognition only links legs of the same owner.
				.leftJoinAndSelect('transaction.ownTransferCounterpart', 'counterpart')
				.leftJoinAndSelect('counterpart.bankAccount', 'counterpartBankAccount')
				.leftJoinAndSelect('counterpartBankAccount.bankConnection', 'counterpartConnection')
				.leftJoinAndSelect('transaction.currencyExchangeCounterpart', 'exchangeCounterpart')
				.leftJoinAndSelect('exchangeCounterpart.bankAccount', 'exchangeCounterpartBankAccount')
				.leftJoinAndSelect('exchangeCounterpartBankAccount.bankConnection', 'exchangeCounterpartConnection')
				.where('account.id = :accountId', {accountId})
		);
	}

	private toResponse(transaction: BankTransaction): BankTransactionResponseDto {
		return {
			...this.toSharedResponseFields(transaction),
			transactionDate: transaction.transactionDate,
			direction: toBankTransactionDirection(transaction.creditDebitIndicator),
			transactionType: transaction.transactionType ?? BANK_TRANSACTION_TYPES.OTHER,
			providerTransactionDescription: transaction.bankTransactionDescription,
			balanceAfterAmount: transaction.balanceAfterAmount,
			balanceAfterCurrency: transaction.balanceAfterCurrency,
			instructedAmount: transaction.instructedAmount,
			instructedCurrency: transaction.instructedCurrency,
			exchangeRate: transaction.exchangeRate,
			exchangeRateUnitCurrency: transaction.exchangeRateUnitCurrency,
			exchangeRateType: transaction.exchangeRateType,
			amountInBaseCurrency: transaction.amountInBaseCurrency,
			baseAmountMethod: transaction.baseAmountMethod,
			baseAmountRateDate: transaction.baseAmountRateDate,
			referenceNumber: transaction.referenceNumber,
			referenceNumberScheme: transaction.referenceNumberScheme,
			bankName: transaction.bankAccount.bankConnection.aspspName,
			bankCountry: transaction.bankAccount.bankConnection.aspspCountry,
			bankAccountName: transaction.bankAccount.name,
			bankAccountAlias: transaction.bankAccount.alias,
			ownTransfer: this.toOwnTransferResponse(transaction),
			ownTransferOverride: transaction.ownTransferOverride ?? null,
			currencyExchangeCounterpart: this.toCounterpartResponse(transaction.currencyExchangeCounterpart),
		};
	}

	private toOwnTransferResponse(transaction: BankTransaction): BankTransactionOwnTransferDto | null {
		if (!transaction.ownTransferEvidence) return null;
		return {
			evidence: transaction.ownTransferEvidence,
			counterpart: this.toCounterpartResponse(transaction.ownTransferCounterpart),
		};
	}

	private toCounterpartResponse(
		counterpart: BankTransaction | null | undefined,
	): BankTransactionCounterpartDto | null {
		if (!counterpart) return null;
		return {
			id: counterpart.id,
			bankName: counterpart.bankAccount.bankConnection.aspspName,
			bankAccountName: counterpart.bankAccount.name,
			bankAccountAlias: counterpart.bankAccount.alias,
			amount: counterpart.amount,
			currency: counterpart.currency,
			bookingDate: counterpart.bookingDate,
		};
	}

	private toSharedResponseFields(transaction: BankTransaction) {
		const direction = toBankTransactionDirection(transaction.creditDebitIndicator);
		return {
			id: transaction.id,
			bookingDate: transaction.bookingDate,
			valueDate: transaction.valueDate,
			amount: transaction.amount,
			currency: transaction.currency,
			creditDebitIndicator: transaction.creditDebitIndicator,
			transactionStatus: transaction.transactionStatus,
			description: transaction.description,
			displayDescription: transaction.displayDescription,
			counterpartyName: transaction.counterpartyName,
			...toCategorizationFields(transaction),
			financialEventType: transaction.financialEventType,
			financialEventSource: transaction.financialEventSource,
			financialEventRuleVersion: transaction.financialEventRuleVersion,
			cashFlowTreatment: getBankTransactionCashFlowTreatment(
				transaction.financialEventType,
				direction,
				transaction.ownTransferEvidence,
			),
			categoryConfidence: transaction.categoryConfidence,
			merchantCategoryCode: transaction.merchantCategoryCode,
			remittanceInformation: transaction.remittanceInformation,
		};
	}
}

/** The stored categorization columns as the API reports them; a row categorization has not reached is PENDING. */
function toCategorizationFields(
	transaction: Pick<BankTransaction, 'category' | 'categoryStatus' | 'categorySource'>,
): Pick<BankTransactionResponseDto, 'category' | 'categoryStatus' | 'categorySource'> {
	return {
		category: (transaction.category as BankTransactionCategory | null) ?? null,
		categoryStatus: (transaction.categoryStatus ?? 'PENDING') as BankTransactionCategorizationStatus,
		categorySource: (transaction.categorySource as BankTransactionCategorizationSource | null) ?? null,
	};
}
