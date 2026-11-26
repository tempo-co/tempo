import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';

import {BankingModule} from '@modules/banking/banking.module';

import {BankImportUploadQueue} from './api/bank-import-upload-queue';
import {BankImportController} from './api/bank-import.controller';
import {BankImportDoubtfulRow} from './bank-import-doubtful-row.entity';
import {BankImportLayoutMiss} from './bank-import-layout-miss.entity';
import {BankImportLayoutProposal} from './bank-import-layout-proposal.entity';
import {BankImportLayout} from './bank-import-layout.entity';
import {BankImportLayoutService} from './bank-import-layout.service';
import {BankImport} from './bank-import.entity';
import {BankImportService} from './bank-import.service';
import {BankRequest} from './bank-request.entity';
import {BankRequestService} from './bank-request.service';
import {ImportedRowRecordsService} from './imported-row-records.service';
import {LayoutMapper} from './mapper/layout-mapper';
import {ParseRunnerService} from './runner/parse-runner.service';

/** Statement file import into synced and imported-files accounts, behind `FILE_IMPORT_ENABLED`. */
@Module({
	imports: [
		TypeOrmModule.forFeature([
			BankImport,
			BankImportDoubtfulRow,
			BankImportLayout,
			BankImportLayoutMiss,
			BankImportLayoutProposal,
			BankRequest,
		]),
		BankingModule,
	],
	providers: [
		BankImportService,
		BankImportLayoutService,
		ImportedRowRecordsService,
		LayoutMapper,
		ParseRunnerService,
		BankImportUploadQueue,
		BankRequestService,
	],
	controllers: [BankImportController],
})
export class FileImportModule {}
