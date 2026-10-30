import type {BankTransactionCategory} from '@tempo/contracts';

import type {BankTransactionDirection} from '../../bank-transaction-direction';
import type {
	BankTransactionCashFlowTreatment,
	BankTransactionFinancialEventSource,
	BankTransactionFinancialEventType,
} from '../../bank-transaction-financial-event';
import type {BankTransactionType} from '../../bank-transaction-type';
import type {BankTransactionBaseAmountMethod} from '../../bank-transaction.entity';
import type {
	BankTransactionCategorizationSource,
	BankTransactionCategorizationStatus,
} from '../../categorization/bank-transaction-categorization.types';
import type {OwnTransferEvidence, OwnTransferOverride} from '../../own-transfer/own-transfer-detection';

/** The other leg of an own transfer or currency exchange. */
export class BankTransactionCounterpartDto {
	id: string;
	bankName: string;
	bankAccountName: string | null;
	bankAccountAlias: string | null;
	amount: string;
	currency: string;
	bookingDate: string | null;
}

export class BankTransactionOwnTransferDto {
	evidence: OwnTransferEvidence;
	/** The other leg, or null when no matching transaction is in the connected accounts. */
	counterpart: BankTransactionCounterpartDto | null;
}

export class BankTransactionResponseDto {
	id: string;
	transactionDate: string | null;
	bookingDate: string | null;
	valueDate: string | null;
	description: string | null;
	displayDescription: string;
	/** Path of the merchant's logo image, null when no confirmed logo exists. */
	merchantLogoUrl: string | null;
	counterpartyName: string | null;
	amount: string;
	currency: string;
	creditDebitIndicator: string | null;
	direction: BankTransactionDirection;
	transactionType: BankTransactionType;
	transactionStatus: string | null;
	category: BankTransactionCategory | null;
	categoryStatus: BankTransactionCategorizationStatus;
	categorySource: BankTransactionCategorizationSource | null;
	financialEventType: BankTransactionFinancialEventType | null;
	financialEventSource: BankTransactionFinancialEventSource | null;
	financialEventRuleVersion: string | null;
	cashFlowTreatment: BankTransactionCashFlowTreatment;
	ownTransfer: BankTransactionOwnTransferDto | null;
	ownTransferOverride: OwnTransferOverride | null;
	/** The other leg of a currency exchange, or null when it is not one or the legs could not be matched. */
	currencyExchangeCounterpart: BankTransactionCounterpartDto | null;
	categoryConfidence: string | null;
	providerTransactionDescription: string | null;
	merchantCategoryCode: string | null;
	remittanceInformation: string | null;
	balanceAfterAmount: string | null;
	balanceAfterCurrency: string | null;
	instructedAmount: string | null;
	instructedCurrency: string | null;
	exchangeRate: string | null;
	exchangeRateUnitCurrency: string | null;
	exchangeRateType: string | null;
	/** The amount in the owner's base currency, to the cent; null while unconverted. */
	amountInBaseCurrency: string | null;
	/** How the base-currency amount was derived; null while unconverted. */
	baseAmountMethod: BankTransactionBaseAmountMethod | null;
	/** The ECB reference rate date used when `baseAmountMethod` is `ECB`. */
	baseAmountRateDate: string | null;
	referenceNumber: string | null;
	referenceNumberScheme: string | null;
	bankName: string;
	bankCountry: string;
	bankAccountName: string | null;
	bankAccountAlias: string | null;
}

export class BankTransactionsResponseDto {
	transactions: BankTransactionResponseDto[];
	total: number;
}
