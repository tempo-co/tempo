import {BullModule} from '@nestjs/bullmq';
import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';

import {EmailModule} from '@core/email/email.module';
import {
	BANK_CONNECTION_ALERT_QUEUE,
	BANK_CONNECTION_SYNC_QUEUE,
	BANK_TRANSACTION_AMOUNT_CONVERSION_QUEUE,
} from '@core/queue/queue.constants';
import {RedisModule} from '@core/redis/redis.module';
import {Account} from '@modules/account/account.entity';
import {AccountModule} from '@modules/account/account.module';
import {NotificationsModule} from '@modules/notifications/notifications.module';

import {BankConnectionAlertProcessor} from './alerts/bank-connection-alert.processor';
import {BankConnectionAlertService} from './alerts/bank-connection-alert.service';
import {PushAlertProcessor} from './alerts/push-alert.processor';
import {BankConnectionController} from './api/bank-connection.controller';
import {BankTransactionController} from './api/bank-transaction.controller';
import {McpController} from './api/mcp.controller';
import {MerchantController} from './api/merchant.controller';
import {RecurringSeriesController} from './api/recurring-series.controller';
import {BankAccountBalance} from './bank-account-balance.entity';
import {BankAccount} from './bank-account.entity';
import {BankConnection} from './bank-connection.entity';
import {BankLogoController} from './bank-logos/bank-logo.controller';
import {BankLogoService} from './bank-logos/bank-logo.service';
import {BankSyncRun} from './bank-sync-run.entity';
import {BankTransactionFxRate} from './bank-transaction-fx-rate.entity';
import {BankTransaction} from './bank-transaction.entity';
import {BankTransactionCategorizationModule} from './categorization/bank-transaction-categorization.module';
import {MerchantLogoModule} from './merchant-logos/merchant-logo.module';
import {RecurringContinuationUnlink} from './recurring/recurring-continuation-unlink.entity';
import {RecurringSeriesHide} from './recurring/recurring-series-hide.entity';
import {RecurringSeriesService} from './recurring/recurring-series.service';
import {RecurringSnapshot} from './recurring/recurring-snapshot.entity';
import {AspspCatalogService} from './services/aspsp-catalog.service';
import {BankAuthorizationService} from './services/bank-authorization.service';
import {BankConnectionQueryService} from './services/bank-connection-query.service';
import {BankConnectionRemovalService} from './services/bank-connection-removal.service';
import {BankTransactionAmountConversionProcessor} from './services/bank-transaction-amount-conversion.processor';
import {BankTransactionAmountConversionQueueService} from './services/bank-transaction-amount-conversion.queue.service';
import {BankTransactionAmountConversionService} from './services/bank-transaction-amount-conversion.service';
import {BankTransactionHistoryService} from './services/bank-transaction-history.service';
import {BankTransactionPersistenceService} from './services/bank-transaction-persistence.service';
import {BankTransactionSummaryService} from './services/bank-transaction-summary.service';
import {BankTransactionService} from './services/bank-transaction.service';
import {BankingAuthorizationStateModule} from './services/banking-authorization-state.module';
import {BankingConnectionLockService} from './services/banking-connection-lock.service';
import {BankingConsentRevocationModule} from './services/banking-consent-revocation.module';
import {BankingSyncQueueService} from './services/banking-sync-queue.service';
import {BankingSyncProcessor} from './services/banking-sync.processor';
import {BankingSyncService} from './services/banking-sync.service';
import {CurrencyExchangeService} from './services/currency-exchange.service';
import {FileAccountBalanceService} from './services/file-account-balance.service';
import {FxRateService} from './services/fx-rate.service';
import {McpReaderService} from './services/mcp-reader.service';
import {MerchantSpendingService} from './services/merchant-spending.service';
import {OwnTransferService} from './services/own-transfer.service';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			Account,
			BankConnection,
			BankAccount,
			BankSyncRun,
			BankAccountBalance,
			BankTransaction,
			BankTransactionFxRate,
			RecurringSeriesHide,
			RecurringContinuationUnlink,
			RecurringSnapshot,
		]),
		BullModule.registerQueue({name: BANK_CONNECTION_SYNC_QUEUE}),
		BullModule.registerQueue({name: BANK_TRANSACTION_AMOUNT_CONVERSION_QUEUE}),
		BullModule.registerQueue({name: BANK_CONNECTION_ALERT_QUEUE}),
		EmailModule,
		AccountModule,
		RedisModule,
		BankingAuthorizationStateModule,
		BankingConsentRevocationModule,
		BankTransactionCategorizationModule,
		MerchantLogoModule,
		NotificationsModule,
	],
	providers: [
		AspspCatalogService,
		BankAuthorizationService,
		BankConnectionQueryService,
		FileAccountBalanceService,
		BankConnectionRemovalService,
		BankLogoService,
		McpReaderService,
		BankingConnectionLockService,
		BankTransactionPersistenceService,
		BankingSyncService,
		BankingSyncQueueService,
		BankingSyncProcessor,
		BankTransactionService,
		BankTransactionSummaryService,
		BankTransactionHistoryService,
		MerchantSpendingService,
		BankTransactionAmountConversionService,
		BankTransactionAmountConversionQueueService,
		BankTransactionAmountConversionProcessor,
		FxRateService,
		OwnTransferService,
		CurrencyExchangeService,
		BankConnectionAlertService,
		BankConnectionAlertProcessor,
		PushAlertProcessor,
		RecurringSeriesService,
	],
	exports: [
		BankTransactionPersistenceService,
		FileAccountBalanceService,
		BankingConnectionLockService,
		OwnTransferService,
		CurrencyExchangeService,
		BankTransactionCategorizationModule,
		MerchantLogoModule,
	],
	controllers: [
		BankConnectionController,
		BankLogoController,
		BankTransactionController,
		MerchantController,
		RecurringSeriesController,
		McpController,
	],
})
export class BankingModule {}
