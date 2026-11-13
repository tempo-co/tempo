import {BullModule} from '@nestjs/bullmq';
import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';

import {BANK_TRANSACTION_CATEGORIZATION_QUEUE} from '@core/queue/queue.constants';

import {BankTransaction} from '../bank-transaction.entity';
import {BankTransactionCategorizationProcessor} from './bank-transaction-categorization.processor';
import {BANK_TRANSACTION_CATEGORIZATION_PROVIDER} from './bank-transaction-categorization.provider';
import {CategorizationContextLoader} from './categorization-context-loader.service';
import {CategorizationPipeline} from './categorization-pipeline.service';
import {CategorizationRowStore} from './categorization-row-store.service';
import {CategorizationScheduler} from './categorization-scheduler.service';
import {ManualCategoryService} from './manual-category.service';
import {ClaudeBankTransactionCategorizationProvider} from './providers/claude-bank-transaction-categorization.provider';

@Module({
	imports: [
		BullModule.registerQueue({name: BANK_TRANSACTION_CATEGORIZATION_QUEUE}),
		TypeOrmModule.forFeature([BankTransaction]),
	],
	providers: [
		ClaudeBankTransactionCategorizationProvider,
		{provide: BANK_TRANSACTION_CATEGORIZATION_PROVIDER, useExisting: ClaudeBankTransactionCategorizationProvider},
		CategorizationScheduler,
		CategorizationRowStore,
		CategorizationContextLoader,
		ManualCategoryService,
		CategorizationPipeline,
		BankTransactionCategorizationProcessor,
	],
	exports: [CategorizationScheduler, ManualCategoryService, ClaudeBankTransactionCategorizationProvider],
})
export class BankTransactionCategorizationModule {}
