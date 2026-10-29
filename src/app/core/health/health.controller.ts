import {Controller, Get} from '@nestjs/common';
import {HealthCheck, HealthCheckService, TypeOrmHealthIndicator} from '@nestjs/terminus';

import {Public} from '@modules/auth/decorators/public.decorator';

@Controller('health')
export class HealthController {
	constructor(
		private health: HealthCheckService,
		private db: TypeOrmHealthIndicator,
	) {}

	@Get()
	@Public()
	@HealthCheck()
	async check() {
		return await this.health.check([async () => ({api: {status: 'up'}}), () => this.db.pingCheck('database')]);
	}
}
