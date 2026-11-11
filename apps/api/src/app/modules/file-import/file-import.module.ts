import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';

import {BankingModule} from '@modules/banking/banking.module';

import {BankImportController} from './api/bank-import.controller';
import {BankImport} from './bank-import.entity';
import {BankImportService} from './bank-import.service';
import {ParseRunnerService} from './runner/parse-runner.service';

/** Statement file import into the owner's imported-files accounts, behind `FILE_IMPORT_ENABLED`. */
@Module({
	imports: [TypeOrmModule.forFeature([BankImport]), BankingModule],
	providers: [BankImportService, ParseRunnerService],
	controllers: [BankImportController],
})
export class FileImportModule {}
