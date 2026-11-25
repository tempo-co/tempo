import {Module} from '@nestjs/common';

import {EmailModule} from '@core/email/email.module';

import {OperatorAlertService} from './operator-alert.service';

@Module({
	imports: [EmailModule],
	providers: [OperatorAlertService],
	exports: [OperatorAlertService],
})
export class OperatorAlertModule {}
