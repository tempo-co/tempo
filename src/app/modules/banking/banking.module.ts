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

import {BankConnectionAlertProcessor} from './alerts/bank-connection-alert.processor';
import {BankConnectionAlertService} from './alerts/bank-connection-alert.service';
import {BankConnectionController} from './api/bank-connection.controller';
import {BankTransactionController} from './api/bank-transaction.controller';
import {RecurringSeriesController} from './api/recurring-series.controller';
import {BankAccountBalance} from './bank-account-balance.entity';
import {BankAccount} from './bank-account.entity';
import {BankConnection} from './bank-connection.entity';
import {BankSyncRun} from './bank-sync-run.entity';
import {BankTransactionFxRate} from './bank-transaction-fx-rate.entity';
import {BankTransaction} from './bank-transaction.entity';
import {BankingService} from './banking.service';
import {BankTransactionCategorizationModule} from './categorization/bank-transaction-categorization.module';
import {RecurringSeriesDecision} from './recurring/recurring-series-decision.entity';
import {RecurringSeriesService} from './recurring/recurring-series.service';
import {BankTransactionAmountConversionProcessor} from './services/bank-transaction-amount-conversion.processor';
import {BankTransactionAmountConversionQueueService} from './services/bank-transaction-amount-conversion.queue.service';
import {BankTransactionAmountConversionService} from './services/bank-transaction-amount-conversion.service';
import {BankTransactionSummaryService} from './services/bank-transaction-summary.service';
import {BankTransactionService} from './services/bank-transaction.service';
import {BankingAuthorizationStateModule} from './services/banking-authorization-state.module';
import {BankingConnectionLockService} from './services/banking-connection-lock.service';
import {BankingEncryptionService} from './services/banking-encryption.service';
import {BankingSyncQueueService} from './services/banking-sync-queue.service';
import {BankingSyncProcessor} from './services/banking-sync.processor';
import {BankingSyncService} from './services/banking-sync.service';
import {CurrencyExchangeService} from './services/currency-exchange.service';
import {EnableBankingClient} from './services/enable-banking.client';
import {FxRateService} from './services/fx-rate.service';
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
			RecurringSeriesDecision,
		]),
		BullModule.registerQueue({name: BANK_CONNECTION_SYNC_QUEUE}),
		BullModule.registerQueue({name: BANK_TRANSACTION_AMOUNT_CONVERSION_QUEUE}),
		BullModule.registerQueue({name: BANK_CONNECTION_ALERT_QUEUE}),
		EmailModule,
		AccountModule,
		RedisModule,
		BankingAuthorizationStateModule,
		BankTransactionCategorizationModule,
	],
	providers: [
		BankingService,
		BankingConnectionLockService,
		BankingSyncService,
		BankingSyncQueueService,
		BankingSyncProcessor,
		BankTransactionService,
		BankTransactionSummaryService,
		BankTransactionAmountConversionService,
		BankTransactionAmountConversionQueueService,
		BankTransactionAmountConversionProcessor,
		FxRateService,
		EnableBankingClient,
		BankingEncryptionService,
		OwnTransferService,
		CurrencyExchangeService,
		BankConnectionAlertService,
		BankConnectionAlertProcessor,
		RecurringSeriesService,
	],
	controllers: [BankConnectionController, BankTransactionController, RecurringSeriesController],
})
export class BankingModule {}
